'use strict';

/**
 * Action: Endpoint Build ApiGateway
 * - Creates API Gateway endpoints on the AWS account.
 * - Handles one endpoint only in one region.  The FunctionDeploy Action orchestrates this.
 */

module.exports = function(SPlugin, serverlessPath) {
  const path        = require('path'),
    SError          = require(path.join(serverlessPath, 'ServerlessError')),
    SUtils          = require(path.join(serverlessPath, 'utils/index')),
    BbPromise       = require('bluebird'),
    async           = require('async'),
    fs              = require('fs'),
    os              = require('os');

  // Promisify fs module
  BbPromise.promisifyAll(fs);

  class EndpointBuildApiGateway extends SPlugin {

    /**
     * Constructor
     */

    constructor(S, config) {
      super(S, config);
    }

    /**
     * Get Name
     */

    static getName() {
      return 'serverless.core.' + EndpointBuildApiGateway.name;
    }

    /**
     * Register Actions
     */

    registerActions() {
      this.S.addAction(this.endpointBuildApiGateway.bind(this), {
        handler:     'endpointBuildApiGateway',
        description: 'Provision one or multiple endpoints on API Gateway',
      });
      return BbPromise.resolve();
    }

    /**
     * Endpoint Build ApiGateway
     */

    endpointBuildApiGateway(evt) {
      let builder = new Builder(this.S);
      return builder.build(evt);
    }
  }

  /**
   * Builder
   * - Necessary for this action to run concurrently
   */

  class Builder {

    constructor(S) {
      this.S = S;
    }

    build(evt) {

      let _this     = this;
      _this.evt     = evt;

      return _this._validateAndPrepare()
        .bind(_this)
        .then(_this._getRestApi)
        .then(_this._fetchDeployedLambda)
        .then(_this._getApiResources)
        .then(_this._createEndpointResources)
        .then(_this._createEndpointMethod)
        .then(_this._createEndpointIntegration)
        .then(_this._createEndpointMethodResponses)
        .then(_this._createEndpointMethodIntegResponses)
        .then(_this._manageLambdaAccessPolicy)
        .then(function() {

          _this.url = 'https://'
            +  _this.restApi.id
            + '.execute-api.'
            +  _this.evt.options.region
            + '.amazonaws.com/'
            + _this.evt.options.stage
            + _this.endpoint.path;

          SUtils.sDebug(
            '"'
            + _this.evt.options.stage
            + '" successfully built endpoint on API Gateway in the region "'
            + _this.evt.options.region
            + '". Access it via '
            + _this.endpoint.method
            + ' @ '
            + _this.url);

          /**
           * Return EVT
           */

          _this.evt.data.url = _this.url;
          return _this.evt;

        });
    }

    /**
     * Validate And Prepare
     */

    _validateAndPrepare() {

      let _this = this;

      // Instantiate Classes
      _this.project    = _this.S.state.getProject();
      _this.meta       = _this.S.state.getMeta();

      // If no iamRoleLambda, throw error
      if (!_this.meta.stages[_this.evt.options.stage].regions[_this.evt.options.region].variables.iamRoleArnLambda) {
        throw new SError('No Lambda IAM Role found');
      }

      // Define useful variables
      _this.awsAccountNumber     = _this.meta.stages[_this.evt.options.stage].regions[_this.evt.options.region].variables.iamRoleArnLambda.replace('arn:aws:iam::', '').split(':')[0];
      _this.restApiName          = _this.meta.stages[_this.evt.options.stage].regions[_this.evt.options.region].variables.apiGatewayApi;
      _this.resource             = null;
      _this.resourceParent       = null;
      _this.prevIntegration      = null;
      _this.integration          = null;
      _this.lambda               = null;
      _this.apiResources         = null;

      // Load AWS Service Instances
      let awsConfig = {
        region:          _this.evt.options.region,
        accessKeyId:     _this.S.config.awsAdminKeyId,
        secretAccessKey: _this.S.config.awsAdminSecretKey
      };

      _this.CloudFormation = require('../utils/aws/CloudFormation')(awsConfig);
      _this.ApiGateway     = require('../utils/aws/ApiGateway')(awsConfig);
      _this.Lambda         = require('../utils/aws/Lambda')(awsConfig);

      // Get populated endpoint
      _this.endpoint = _this.S.state.getEndpoints({
        paths: [_this.evt.options.path]
      })[0];

      if (!_this.endpoint) BbPromise.reject(new SError(`Endpoint could not be found: ${_this.evt.options.path}`));

      // Set function name
      _this.functionName = _this.endpoint.getFunction().getDeployedName({
        stage: _this.evt.options.stage,
        region: _this.evt.options.region
      });

      // Populate endpoint
      _this.endpoint = _this.endpoint.getPopulated({ stage: _this.evt.options.stage, region: _this.evt.options.region });

      // Validate and sanitize endpoint attributes
      if (!_this.endpoint.path) {
        throw new SError('Endpoint does not have a "path" property');
      }
      if (!_this.endpoint.method) {
        throw new SError('Endpoint does not have a "method" property');
      }
      if (!_this.endpoint.authorizationType) {
        throw new SError('Endpoint does not have a "authorizationType" property');
      }
      if (typeof _this.endpoint.apiKeyRequired === 'undefined') {
        throw new SError('Endpoint does not have a "apiKeyRequired" property');
      }
      if (!_this.endpoint.requestTemplates) {
        throw new SError('Endpoint does not have a "requestTemplates" property');
      }
      if (!_this.endpoint.requestParameters) {
        throw new SError('Endpoint does not have a "requestParameters" property');
      }
      if (!_this.endpoint.responses) {
        throw new SError('Endpoint does not have a "responses" property');
      }

      // Sanitize path - Remove excessive forward slashes
      if (_this.endpoint.path.charAt(0) !== '/') _this.endpoint.path = '/' + _this.endpoint.path;
      if (_this.endpoint.path.charAt(_this.endpoint.path.length) === '/') _this.endpoint.path = _this.endpoint.path.slice(0, -1);

      // Sanitize method
      _this.endpoint.method = _this.endpoint.method.toUpperCase();

      return BbPromise.resolve();
    }

    /**
     * Get REST API
     */

    _getRestApi() {

      let _this = this;

      return _this.ApiGateway.sGetApiByName(_this.restApiName, _this.evt.options.stage, _this.evt.options.region)
        .then(function(restApi) {

          if (!restApi) {
            throw new SError('API Gateway REST API with the name: ' + _this.restApi);
          }

          // Store restApi
          _this.restApi = restApi;
        });
    }

    /**
     * Fetch Deployed Lambda
     * @private
     */

    _fetchDeployedLambda() {

      let _this = this;
      let endpointInstance = _this.S.state.getEndpoints({
        paths: [_this.evt.options.path]
      })[0];

      let params = {
        FunctionName: _this.functionName,
        Qualifier:    _this.evt.options.stage
      };

      return _this.Lambda.getFunctionPromised(params)
        .then(function(data) {

          _this.deployedLambda = data.Configuration;

          // Prepare StatementId
          _this.lambdaPolicyStatementId = ('s_apig' + _this.endpoint.path + '_' + _this.endpoint.method).replace(/[\/{}]/g, '_');

          SUtils.sDebug(
            '"'
            + _this.evt.options.stage
            + ' - '
            + _this.evt.options.region
            + ' - '
            + _this.endpoint.path
            + '": found the target lambda with function name: '
            + _this.deployedLambda.FunctionName);
        });
    }

    /**
     * Get API Resources
     * @returns {Promise}
     * @private
     */

    _getApiResources() {

      let _this = this;


      let params = {
        restApiId: _this.restApi.id, /* required */
        limit: 500
      };

      // List all Resources for this REST API
      return SUtils.persistentRequest(function() { return _this.ApiGateway.getResourcesPromised(params); })
        .then(function(response) {
          _this.apiResources = response.items;

          SUtils.sDebug(
            '"'
            + _this.evt.options.stage
            + ' - '
            + _this.evt.options.region
            + ' - '
            + _this.endpoint.path
            + '": found '
            + _this.apiResources.length
            + ' existing Resources on API Gateway');
        });
    }

    /**
     * Create Endpoint Resources
     */

    _createEndpointResources() {

      let _this = this;

      /**
       * Find Parent
       * - We always want to provide the parent resource on the EVENT object.
       * - Here is a private, reusable function to find and add it
       */

      let findParent = function(resource) {

        let parentPath = resource.split('/');
        if (parentPath.length > 1) {
          parentPath.pop();
          parentPath = '/' + parentPath.join('/');
        } else {
          parentPath = '/';
        }

        for (let i = 0; i < _this.apiResources.length; i++) {
          if (_this.apiResources[i].path === parentPath) {
            _this.resourceParent = _this.apiResources[i];
            break;
          }
        }
      };

      // Check paths to see if resources need building
      for (let i = 0; i < _this.apiResources.length; i++) {
        if (_this.apiResources[i].path === _this.endpoint.path) {
          _this.resource = _this.apiResources[i];
          break;
        }
      }

      // If all Endpoint resources exist already, load parent resource, skip the rest of this function
      if (_this.resource) {
        findParent(_this.resource.path);

        SUtils.sDebug(
          '"'
          + _this.evt.options.stage
          + ' - '
          + _this.evt.options.region
          + ' - '
          + _this.endpoint.path
          + '": '
          + '": no resources need to be created for this endpoint');

        return BbPromise.resolve();
      }

      let eResources = _this.endpoint.path.split('/');
      eResources[0] = '/'; // Our split removes the initial '/' and leaves an empty string, replace it

      return new BbPromise(function(resolve, reject) {

        // Loop through each resource in this Endpoint and create it if it is missing.
        let incrementedPath = '';
        async.eachSeries(eResources, function(eResource, cb) {

          // Build the path w/ new resource on each iteration
          if (incrementedPath === '') {
            incrementedPath = eResource;
          } else if (incrementedPath === '/') {
            incrementedPath = incrementedPath + eResource;
          } else {
            incrementedPath = incrementedPath + '/' + eResource;
          }

          // If exists in APIG resources, skip this
          let parentPath = '';
          let resourceExists = false;

          for (let i = 0; i < _this.apiResources.length; i++) {
            // Resource exists, save it to Event object, break loop
            if (_this.apiResources[i].path === incrementedPath) {
              resourceExists = true;
              break;
            }
          }

          // Resource exists, skip this iteration
          if (resourceExists) return cb();

          // Find Parent
          let parent = incrementedPath.split('/');
          if (parent.length === 2) {
            parent = '/';
          } else {
            parent = incrementedPath.substring(0, incrementedPath.lastIndexOf('/'));
          }

          for (let i = 0; i < _this.apiResources.length; i++) {
            if (_this.apiResources[i].path === parent) {
              parent = _this.apiResources[i];
              break;
            }
          }
          _this.resourceParent = parent;

          // Resource doesn't exist, so make it
          let params = {
            parentId:  _this.resourceParent.id, /* required */
            pathPart:  eResource, /* required */
            restApiId: _this.restApi.id /* required */
          };

          // Create Resource
          return SUtils.persistentRequest(function() { return _this.ApiGateway.createResourcePromised(params); } )
            .then(function(response) {

              // Save resource
              _this.resource = response;

              // Add resource to _this.resources and callback
              _this.apiResources.push(response);

              SUtils.sDebug(
                '"'
                + _this.evt.options.stage + ' - '
                + _this.evt.options.region
                + ' - ' + _this.endpoint.path + '": '
                + 'created resource: '
                + response.pathPart);

              // Return callback to iterate loop
              return cb();
            });
        }, function() {
          return resolve();
        }); // async.eachSeries
      });
    }

    /**
     * Create Endpoint Method
     */

    _createEndpointMethod() {

      let _this             = this,
        requestParameters = {};

      // If Request Params, add them
      if (_this.endpoint.requestParameters) {

        // Format them per APIG API's Expectations
        for (let prop in _this.endpoint.requestParameters) {
          let requestParam                = _this.endpoint.requestParameters[prop];
          requestParameters[requestParam] = true;
        }
      }

      let params = {
        httpMethod: _this.endpoint.method, /* required */
        resourceId: _this.resource.id, /* required */
        restApiId:  _this.restApi.id /* required */
      };

      return SUtils.persistentRequest( function(){ return _this.ApiGateway.getMethodPromised(params); } )
        .then(function(response) {

          // Method exists.  Delete and recreate it.

          // First, save integration's Lambda aliasEndpoint, if any
          if (response.methodIntegration) {
            _this.prevIntegration = response.methodIntegration;
          }

          let params = {
            httpMethod: _this.endpoint.method, /* required */
            resourceId: _this.resource.id, /* required */
            restApiId:  _this.restApi.id /* required */
          };

          return SUtils.persistentRequest( function(){ return _this.ApiGateway.deleteMethodPromised(params); } )
            .then(function(response) {

              let params = {
                authorizationType:  _this.endpoint.authorizationType, /* required */
                httpMethod:         _this.endpoint.method, /* required */
                resourceId:         _this.resource.id, /* required */
                restApiId:          _this.restApi.id, /* required */
                apiKeyRequired:     _this.endpoint.apiKeyRequired,
                requestModels:      _this.endpoint.requestModels || {},
                requestParameters:  requestParameters
              };

              return SUtils.persistentRequest( function(){ return _this.ApiGateway.putMethodPromised(params); } )

            });
        }, function(error) {

          // Method does not exist.  Create it.

          let params = {
            authorizationType:  _this.endpoint.authorizationType, /* required */
            httpMethod:         _this.endpoint.method, /* required */
            resourceId:         _this.resource.id, /* required */
            restApiId:          _this.restApi.id, /* required */
            apiKeyRequired:     _this.endpoint.apiKeyRequired,
            requestModels:      _this.endpoint.requestModels || {},
            requestParameters:  requestParameters
          };

          return SUtils.persistentRequest( function(){ return _this.ApiGateway.putMethodPromised(params); } );
        })
        .then(function(response) {

          SUtils.sDebug(
            '"'
            + _this.evt.options.stage + ' - '
            + _this.evt.options.region
            + ' - ' + _this.endpoint.path + '": '
            + 'created method: '
            + _this.endpoint.method);
        });
    }

    /*
     Coerce the _this.endpoint.requestTemplates[prop] values.  Previously this was only validly a string.  Often that
     string contained a stringified JSON object.  For those cases, dealing with and modifying the string was painful.  As
     such, this method enables the string to validly be of a different type.  In this expansion, an object.
     */

    _prepareRequestTemplates(requestTemplates) {
      let ret = {};
      for (let property in requestTemplates) {
        if (requestTemplates.hasOwnProperty(property)) {
          if(typeof requestTemplates[property] === 'object') { // this code adding a JSON object case for valid values of requestTemplates key's values.  If more variants are added, a more careful inspection of requestTemplates[property] will be important.
            ret[property] = JSON.stringify(requestTemplates[property]);
            // This does a regex search and replace for the "$input.json()" value and removes the surrounding quotes.
            // This is a workaround for the AWS quirk of using the Apache Velocity syntax that is a superset of JSON. 
            // This in turn forces us to use strings in our config instead of normal JSON.
            ret[property] = ret[property].replace(/"\$input\.json\(['\\"]+([^\\\)]+)['\\"]+\)"/g, "$input.json('$1')");
          } else {
            ret[property] = requestTemplates[property]; // do as before
          }
        }
      }
      return ret;
    }
    /**
     * Create Endpoint Integration
     */

    _createEndpointIntegration() {

      let _this           = this;

      // Alias Lambda, default ot $LATEST
      let alias;
      if (_this.evt.options.aliasEndpoint) alias  = _this.evt.options.aliasEndpoint;
      else alias = '${stageVariables.functionAlias}';

      let params = {
        httpMethod:             _this.endpoint.method, /* required */
        resourceId:             _this.resource.id, /* required */
        restApiId:              _this.restApi.id, /* required */
        type:                   _this.endpoint.type, /* required */
        cacheKeyParameters:     _this.endpoint.cacheKeyParameters || [],
        cacheNamespace:         _this.endpoint.cacheNamespace     || null,
        // Due to a bug in API Gateway reported here: https://github.com/awslabs/aws-apigateway-swagger-importer/issues/41
        // Specifying credentials within API Gateway causes extra latency (~500ms)
        // Until API Gateway is fixed, we need to make a separate call to Lambda to add credentials to API Gateway
        // Once API Gateway is fixed, we can use this in credentials:
        // _this._regionJson.iamRoleArnApiGateway
        credentials:            null,
        integrationHttpMethod:  'POST',
        requestParameters:      _this.endpoint.requestParameters || {},
        requestTemplates:       _this._prepareRequestTemplates(_this.endpoint.requestTemplates),
        uri:                    'arn:aws:apigateway:' // Make ARN for apigateway - lambda
        + _this.evt.options.region
        + ':lambda:path/2015-03-31/functions/arn:aws:lambda:'
        + _this.evt.options.region
        + ':'
        + _this.awsAccountNumber
        + ':function:'
        + _this.deployedLambda.FunctionName
        + ':'
        + alias
        + '/invocations'
      };

      // Create Integration
      return SUtils.persistentRequest( function() { return _this.ApiGateway.putIntegrationPromised(params); } )
        .then(function(response) {

          // Save integration
          _this.integration = response;

          SUtils.sDebug(
            '"'
            + _this.evt.options.stage + ' - '
            + _this.evt.options.region
            + ' - ' + _this.endpoint.path + '": '
            + 'created integration with the type: ' + response.type);
        })
        .catch(function(error) {
          throw new SError(
            error.message,
            SError.errorCodes.UNKNOWN);
        });
    }

    /**
     * Create Endpoint Method Response
     */

    _createEndpointMethodResponses() {

      let _this           = this;

      return BbPromise.try(function() {

          // Collect Response Keys
          if (_this.endpoint.responses) return Object.keys(_this.endpoint.responses);
          else return [];

        })
        .each(function(responseKey) {

          // Iterate through each response to be created

          let thisResponse       = _this.endpoint.responses[responseKey];
          let responseParameters = {};
          let responseModels     = {};

          // If Response Params, add them
          if (thisResponse.responseParameters) {
            // Format Response Parameters per APIG API's Expectations
            for (let prop in thisResponse.responseParameters) {
              responseParameters[prop] = true;
            }
          }

          // If Request models, add them
          if (thisResponse.responseModels) {
            // Format Response Models per APIG API's Expectations
            for (let name in thisResponse.responseModels) {
              let value            = thisResponse.responseModels[name];
              responseModels[name] = value;
            }
          }

          let params = {
            httpMethod:         _this.endpoint.method, /* required */
            resourceId:         _this.resource.id, /* required */
            restApiId:          _this.restApi.id, /* required */
            statusCode:         thisResponse.statusCode, /* required */
            responseModels:     responseModels,
            responseParameters: responseParameters
          };

          // Create Method Response
          return SUtils.persistentRequest( function(){ return _this.ApiGateway.putMethodResponsePromised(params); } )
            .then(function() {

              SUtils.sDebug(
                '"'
                + _this.evt.options.stage + ' - '
                + _this.evt.options.region
                + ' - ' + _this.endpoint.path + '": '
                + 'created method response');

            })
            .catch(function(error) {

              throw new SError(error.message);
            });
        });
    }

    /**
     * Create Method Integration Response
     */

    _createEndpointMethodIntegResponses() {

      let _this = this;

      return BbPromise.try(function() {

          // Collect Response Keys
          if (_this.endpoint.responses) return Object.keys(_this.endpoint.responses);
          else return [];
        })
        .each(function(responseKey) {

          let thisResponse       = _this.endpoint.responses[responseKey];

          // Add Response Parameters
          let responseParameters = thisResponse.responseParameters || {};

          // Add Response Templates
          let responseTemplates  = thisResponse.responseTemplates || {};

          // Add SelectionPattern
          let selectionPattern   = thisResponse.selectionPattern || (responseKey === 'default' ? null : responseKey);

          let params = {
            httpMethod:         _this.endpoint.method, /* required */
            resourceId:         _this.resource.id, /* required */
            restApiId:          _this.restApi.id, /* required */
            statusCode:         thisResponse.statusCode, /* required */
            responseParameters: responseParameters,
            responseTemplates:  responseTemplates,
            selectionPattern:   selectionPattern
          };

          // Create Integration Response
          return SUtils.persistentRequest( function(){ return _this.ApiGateway.putIntegrationResponsePromised(params); } )
            .then(function() {

              SUtils.sDebug(
                '"'
                + _this.evt.options.stage + ' - '
                + _this.evt.options.region
                + ' - ' + _this.endpoint.path + '": '
                + 'created method integration response');

            }).catch(function(error) {
              throw new SError(error.message);
            });
        });
    }

    /**
     * Manage Lambda Access Policy
     */

    _manageLambdaAccessPolicy() {

      let _this = this;

      // If method integration is not for a lambda, skip
      if (!_this.deployedLambda) return Promise.resolve();

      return _this._getLambdaAccessPolicy()
        .bind(_this)
        .then(_this._removeLambdaPermissionForEndpoint)
        .then(_this._addLambdaPermissionForEndpoint);
    }

    /**
     * Get Lambda Access Policy
     * - Since specifying credentials when creating the Method Integration results in ~500ms
     * - of extra latency, this function updates the lambda's access policy instead
     * - to grant API Gateway permission.  This is how the API Gateway console does it.
     * - But this is not finished and the "getPolicy" method in the SDK is broken, so this
     * - is currently impossible to implement.
     */

    _getLambdaAccessPolicy() {

      let _this  = this;

      let params = {
        FunctionName: _this.deployedLambda.FunctionArn /* required */
        //Qualifier: 'STRING_VALUE'
      };

      return _this.Lambda.getPolicyPromised(params)
        .then(function(data) {
          _this.deployedLambda.policy = JSON.parse(data.Policy);
        })
        .catch(function(e) {});
    }

    /**
     * Remove Lambda Access Policy
     */

    _removeLambdaPermissionForEndpoint() {

      let _this       = this,
        statement;

      if (_this.deployedLambda.policy) {
        let policy = _this.deployedLambda.policy;
        for (let i = 0; i < policy.Statement.length; i++) {
          statement = policy.Statement[i];
          if (statement.Sid && statement.Sid === _this.lambdaPolicyStatementId) break;
        }
      }

      if (!statement) return BbPromise.resolve();

      let params = {
        FunctionName: _this.deployedLambda.FunctionArn, /* required */
        StatementId:  _this.lambdaPolicyStatementId /* required */
        //Qualifier: 'STRING_VALUE'
      };

      return _this.Lambda.removePermissionPromised(params)
        .then(function(data) {

          SUtils.sDebug(
            '"'
            + _this.evt.options.stage + ' - '
            + _this.evt.options.region
            + ' - ' + _this.endpoint.path + '": '
            + 'removed existing lambda access policy statement');
        })
        .catch(function(error) {});
    }

    /**
     * Add Lambda Permission For Endpoint
     */

    _addLambdaPermissionForEndpoint() {

      let _this = this;

      // Sanitize Path - Remove first and last slashes, if any
      _this.endpoint.path = _this.endpoint.path.split('/');
      _this.endpoint.path = _this.endpoint.path.join('/');

      // Create new access policy statement
      let params          = {};
      params.Action       = 'lambda:InvokeFunction';
      params.FunctionName = _this.deployedLambda.FunctionArn;
      params.Principal    = 'apigateway.amazonaws.com';
      params.StatementId  = _this.lambdaPolicyStatementId;
      params.SourceArn    = 'arn:aws:execute-api:'
        + _this.evt.options.region
        + ':'
        + _this.awsAccountNumber
        + ':'
        +  _this.restApi.id
        + '/*/'
        + _this.endpoint.method
        + _this.endpoint.path;

      return _this.Lambda.addPermissionPromised(params)
        .then(function() {

          SUtils.sDebug(
            '"'
            + _this.evt.options.stage
            + ' - '
            + _this.evt.options.region
            + ' - '
            + _this.endpoint.path
            + '": '
            + 'added permission to Lambda');
        })
        .catch(function(error) {
          throw new SError(error.message);
        });
    }

  }

  return( EndpointBuildApiGateway );
};

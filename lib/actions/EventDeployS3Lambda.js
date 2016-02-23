'use strict';

/**
 * EventDeployS3Lambda:
 *     Deploys an S3 based event sources.
 *
 * Options:
 *     - stage: stage to deploy event to
 *     - region: region to deploy event to
 *     - path: event path
 */

module.exports = function(SPlugin, serverlessPath) {

  const path     = require('path'),
    SError       = require(path.join(serverlessPath, 'ServerlessError')),
    SUtils       = require(path.join(serverlessPath, 'utils/index')),
    BbPromise    = require('bluebird');


  class EventDeployS3Lambda extends SPlugin {

    constructor(S, config) {
      super(S, config);
    }

    static getName() {
      return 'serverless.core.' + EventDeployS3Lambda.name;
    }

    registerActions() {

      this.S.addAction(this.eventDeployS3Lambda.bind(this), {
        handler:       'eventDeployS3Lambda',
        description:   'Deploy an S3 event source'
      });

      return BbPromise.resolve();
    }

    /**
     * Code Package Lambda
     */

    eventDeployS3Lambda(evt) {
      let _this     = this;
      _this.evt     = evt;

      if (!_this.evt.options.stage || !_this.evt.options.region || !_this.evt.options.path) {
        return BbPromise.reject(new SError(`Missing stage, region or path.`));
      }
      let event          = _this.S.state.getEvents({ paths: [_this.evt.options.path] })[0],
          populatedEvent = event.getPopulated({stage: _this.evt.options.stage, region: _this.evt.options.region}),
          functionName   = _this.S.state.getFunctions({paths: [_this.evt.options.path.split('#')[0]]})[0].getDeployedName(_this.evt.options),
          statementId    = 'sEvents-' + functionName + '-' + event.name + '-' + _this.evt.options.stage,
          awsAccountId   = _this.S.state.meta.get().stages[_this.evt.options.stage].regions[_this.evt.options.region].variables.iamRoleArnLambda.split('::')[1].split(':')[0],
          lambdaArn      = 'arn:aws:lambda:' + _this.evt.options.region + ':' + awsAccountId + ':function:' + functionName + ':' + _this.evt.options.stage;

      let awsConfig  = {
        region:          _this.evt.options.region,
        accessKeyId:     _this.S.config.awsAdminKeyId,
        secretAccessKey: _this.S.config.awsAdminSecretKey
      };

      _this.S3 = require('../utils/aws/S3')(awsConfig);
      _this.Lambda = require('../utils/aws/Lambda')(awsConfig);

      let params = {
        FunctionName: lambdaArn,
        StatementId: statementId,
        Qualifier: _this.evt.options.stage
      };
      return _this.Lambda.removePermissionPromised(params)
        .then(function(data) {
          SUtils.sDebug(`Removed lambda permission with statement ID: ${statementId}`);
        })
        .catch(function(error) {})
        .then(function (data) {

          SUtils.sDebug(`Adding lambda permission with statement ID: ${statementId}`);

          let params = {
            FunctionName: lambdaArn,
            StatementId: statementId,
            Action: 'lambda:InvokeFunction',
            Principal: 's3.amazonaws.com',
            SourceArn: 'arn:aws:s3:::' + populatedEvent.config.bucket,
            Qualifier: _this.evt.options.stage
          };
          return _this.Lambda.addPermissionPromised(params);
        })
        .then(function(data) {
          let params = {
            Bucket: populatedEvent.config.bucket,
            NotificationConfiguration: {
              LambdaFunctionConfigurations: [
                {
                  Events: populatedEvent.config.bucketEvents,
                  LambdaFunctionArn: lambdaArn
                }
              ]
            }
          };

          return _this.S3.putBucketNotificationConfigurationPromised(params)
        })
        .then(function(data) {

          SUtils.sDebug(`Put notification configuration for bucket ${populatedEvent.config.bucket} and lambda ${lambdaArn}`);

          return BbPromise.resolve(data);
        })
    }
  }


  return( EventDeployS3Lambda );
};

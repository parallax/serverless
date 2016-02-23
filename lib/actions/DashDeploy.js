'use strict';

/**
 * Action: DashDeploy Deploy
 * - Deploys Function Code & Endpoints
 * - Validates Function paths
 * - Loops sequentially through each Region in specified Stage
 * - Passes Function paths to Sub-Actions for deployment
 * - Handles concurrent processing of Sub-Actions for faster deploys
 *
 * Event Properties:
 * - stage:             (String)  The stage to deploy to
 * - regions:           (Array)   The region(s) in the stage to deploy to
 * - aliasFunction:     (String)  Custom Lambda alias.
 * - functions:         (Array)   Array of function JSONs from fun.sl.json
 * - deployed: (Object)  Contains regions and the code functions that have been uploaded to the S3 bucket in that region
 * - description:         (String)  Provide custom description string for API Gateway stage deployment description.
 */

module.exports = function(SPlugin, serverlessPath) {
  const path     = require('path'),
    SError       = require(path.join(serverlessPath, 'ServerlessError')),
    SUtils       = require(path.join(serverlessPath, 'utils/index')),
    SCli         = require(path.join(serverlessPath, 'utils/cli')),
    BbPromise    = require('bluebird'),
    async        = require('async'),
    fs           = require('fs');

  // Promisify fs module
  BbPromise.promisifyAll(fs);

  class DashDeploy extends SPlugin {

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
      return 'serverless.core.' + DashDeploy.name;
    }

    /**
     * Register Plugin Actions
     */

    registerActions() {

      this.S.addAction(this.dashDeploy.bind(this), {
        handler:       'dashDeploy',
        description:   'Serverless Dashboard - Deploys both code & endpoint',
        context:       'dash',
        contextAction: 'deploy',
        options:       [
          {
            option:      'stage',
            shortcut:    's',
            description: 'Optional if only one stage is defined in project'
          }, {
            option:      'region',
            shortcut:    'r',
            description: 'Optional - Target one region to deploy to'
          }, {
            option:      'aliasFunction', // TODO: Implement
            shortcut:    'f',
            description: 'Optional - Provide a custom Alias to your Functions'
          }, {
            option:      'aliasEndpoint', // TODO: Implement
            shortcut:    'e',
            description: 'Optional - Provide a custom Alias to your Endpoints'
          }, {
            option:      'aliasRestApi',  // TODO: Implement
            shortcut:    'a',
            description: 'Optional - Provide a custom Api Gateway Stage Variable for your REST API'
          }, {
            option:      'description',
            shortcut:    'd',
            description: 'Optional - Provide custom description string for API Gateway stage deployment description'
          }
        ]
      });

      return BbPromise.resolve();
    }

    /**
     * Function Deploy
     */

    dashDeploy(evt) {

      let _this      = this;
      _this.evt      = evt;
      _this.evt.data = {};

      // Add defaults
      _this.evt.options.stage               = _this.evt.options.stage ? _this.evt.options.stage : null;
      _this.evt.options.aliasFunction       = _this.evt.options.aliasFunction ? _this.evt.options.aliasFunction : null;
      _this.evt.options.aliasEndpoint       = _this.evt.options.aliasEndpoint ? _this.evt.options.aliasEndpoint : null;
      _this.evt.options.aliasRestApi        = _this.evt.options.aliasRestApi ? _this.evt.options.aliasRestApi : null;
      _this.evt.options.functionPaths       = [];
      _this.evt.options.endpointPaths       = [];
      _this.evt.options.functionPathsDash   = [];
      _this.evt.options.endpointPathsDash   = [];
      _this.evt.data.deployedFunctions      = {};
      _this.evt.data.deployedEndpoints      = {};

      // Instantiate Classes
      _this.project    = _this.S.state.getProject();
      _this.meta       = _this.S.state.getMeta();

      // Flow
      return BbPromise.try(function() {
        })
        .bind(_this)
        .then(_this._validateAndPrepare)
        .then(_this._prompt)
        .then(function() {
          return _this.cliPromptSelectStage('Choose a Stage: ', _this.evt.options.stage, false)
            .then(stage => {
              _this.evt.options.stage = stage;
            })
        })
        .then(function() {
          return _this.cliPromptSelectRegion('Choose a Region in this Stage: ', false, true, _this.evt.options.region, _this.evt.options.stage)
            .then(region => {
              _this.evt.options.region = region;
            })
        })
        .then(_this._deploy)
        .then(function() {
          return _this.evt;
        });
    }

    /**
     * Validate And Prepare
     * - If CLI, maps CLI input to event object
     */

    _validateAndPrepare() {

      let _this = this;

      // If not interactive, throw error
      if (!this.S.config.interactive) {
        return BbPromise.reject(new SError('Sorry, this is only available in interactive mode'));
      }

      // Get all functions in CWD
      let sPath = _this.getSPathFromCwd(_this.S.config.projectPath);

      _this.components = _this.S.state.getComponents({
        paths: sPath ? [sPath] : []
      });

      return BbPromise.resolve();
    }

    /**
     * Prompt
     */

    _prompt() {

      let _this = this,
        data    = {};

      // Prepare function & endpoints choices
      let choices    = [];
      for (let i = 0; i < _this.components.length; i++) {

        let component = _this.components[i];

        for (let j = 0; j < Object.keys(component.functions).length; j++) {

          let func = component.functions[Object.keys(component.functions)[j]];

          // Push function sPath as spacer
          choices.push({
            spacer: func._config.sPath
          });

          choices.push({
            key:        '  ',
            value:      func._config.sPath,
            label:      'function - ' + func._config.sPath,
            type:       'function'
          });

          // If no endpoints, skip iteration
          if (!func.endpoints || !func.endpoints.length) continue;

          // If endpoints, find them
          for (let k = 0; k < func.endpoints.length; k++) {
            choices.push({
              key:        '  ',
              value:      func.endpoints[k]._config.sPath,
              label:      'endpoint - ' + func.endpoints[k]._config.sPath,
              type:       'endpoint'
            });
          }
        }
      }

      // Show ASCII
      SCli.asciiGreeting();

      // Blank space for neatness in the CLI
      console.log('');

      // Show quick help
      SCli.quickHelp();

      // Blank space for neatness in the CLI
      console.log('');

      // Show select input
      return _this.cliPromptSelect('Select the assets you wish to deploy:', choices, true, 'Deploy')
        .then(function(items) {
          // Retrieve only toggled items
          let selectedItems = [];
          for (let i = 0; i < items.length; i++) {
            if (items[i].toggled) {
              if(items[i].type === "function") _this.evt.options.functionPaths.push(items[i].value);
              if(items[i].type === "endpoint") _this.evt.options.endpointPaths.push(items[i].value);
            }
          }

          // Blank space for neatness in the CLI
          console.log('');
        })
    }

    /**
     * Deploy
     */

    _deploy() {

      let _this = this;

      return new BbPromise(function(resolve, reject) {

        // If user selected functions, deploy them
        if (!_this.evt.options.functionPaths || !_this.evt.options.functionPaths.length) return resolve();

        return _this.S.actions.functionDeploy({
            options: {
              stage:  _this.evt.options.stage,
              region: _this.evt.options.region,
              paths:  _this.evt.options.functionPaths
            }
          })
          .then(function(evt) {
            _this.evt.data.deployedFunctions = evt.data.deployed;
            return resolve();
          });
      })
        .then(function() {

          // If user selected endpoints, deploy them
          if (!_this.evt.options.endpointPaths || !_this.evt.options.endpointPaths.length) return;

          return _this.S.actions.endpointDeploy({
              options: {
                stage:       _this.evt.options.stage,
                region:      _this.evt.options.region,
                paths:       _this.evt.options.endpointPaths,
                description: _this.evt.options.description
              }
            })
            .then(function(evt) {
              _this.evt.data.deployedEndpoints = evt.data.deployed;
            });
        })
    }
  }

  return( DashDeploy );
};

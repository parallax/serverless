'use strict';

/**
 * Action: FunctionRunLambdaPython2
 */

module.exports = function(SPlugin, serverlessPath) {
  const path    = require('path'),
    SError      = require(path.join(serverlessPath, 'ServerlessError')),
    SUtils      = require(path.join(serverlessPath, 'utils')),
    spawnSync   = require('child_process').spawnSync,
    SCli        = require(path.join(serverlessPath, 'utils/cli')),
    BbPromise   = require('bluebird'),
    chalk       = require('chalk'),
    context     = require(path.join(serverlessPath, 'utils/context'));

  class FunctionRunLambdaPython2 extends SPlugin {

    constructor(S, config) {
      super(S, config);
    }

    static getName() {
      return 'serverless.core.' + FunctionRunLambdaPython2.name;
    }

    registerActions() {

      this.S.addAction(this.functionRunLambdaPython2.bind(this), {
        handler:       'functionRunLambdaPython2',
        description:   'Runs a service that features a lambda using the python 2.7 runtime.'
      });

      return BbPromise.resolve();
    }

    /**
     * Function Run Lambda Python2
     */

    functionRunLambdaPython2(evt) {

      let _this    = this;
      _this.evt    = evt;

      if (!_this.evt.options.path || _this.evt.options.path.split('/').length < 2) {
        return BbPromise.reject(new SError('Invalid function path. Function path should be in this format: component/function .'));
      }

      // Instantiate Classes
      _this.function = _this.S.state.getFunctions({ paths: [_this.evt.options.path] })[0];

      // Prepare result object
      _this.evt.data.result = { status: false };

      // Run Function
      return new BbPromise(function(resolve) {

        SCli.log(`Running ${_this.function._config.sPath}...`);

        try {

          // Load function file & handler
          let functionFile    = _this.function.handler.split('/').pop().split('.')[0];
          let functionHandler = _this.function.handler.split('/').pop().split('.')[1];
          let functionEvent   = SUtils.readAndParseJsonSync(path.join(_this.function._config.fullPath, 'event.json'));

          functionFile        = path.join(_this.function._config.fullPath, (functionFile + '.py'));

          var child = spawnSync(
            "serverless-run-python-handler",
            [
              '--event', JSON.stringify(functionEvent),
              '--handler-path', functionFile,
              '--handler-function', functionHandler
            ],
            {}
          );

          SCli.log(`-----------------`);
          var handler_result = JSON.parse(child.stdout);
          if (child.status === 0 && handler_result.success) {
            SCli.log(chalk.bold('Success! - This Response Was Returned:'));
            SCli.log(JSON.stringify(handler_result.result));
            _this.evt.data.result.status   = 'success';
            _this.evt.data.result.response = handler_result.result;
          } else {
            SCli.log(chalk.bold('Failed - This Error Was Returned:'));
            SCli.log(child.stdout);
            SCli.log(chalk.bold('Exception message from Python'));
            SCli.log(handler_result.exception);
            _this.evt.data.result.status = 'error';
            _this.evt.data.result.response = handler_result.exception;
          }
          return resolve(evt);
        } catch(err) {

          SCli.log(chalk.bold('Failed - This Error Was Thrown:'));
          SCli.log(err);
          _this.evt.data.result.status   = 'error';
          _this.evt.data.result.response = err.message;
          return resolve();
        }
      })
        .then(function() {

          /**
           * Return EVT
           */

          return _this.evt;

        })
    }
  }

  return( FunctionRunLambdaPython2 );
};

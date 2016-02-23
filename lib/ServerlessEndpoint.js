'use strict';

/**
 * Serverless Endpoint Class
 * - options.path format is: "component/functionParentFolders(ifAny)/functionFolder@endpointPath~endpointMethod
 */

const SError   = require('./ServerlessError'),
  SUtils       = require('./utils/index'),
  BbPromise    = require('bluebird'),
  path         = require('path'),
  fs           = require('fs'),
  _            = require('lodash');

class ServerlessEndpoint {

  /**
   * Constructor
   */

  constructor(Serverless, config) {

    // Validate required attributes
    if ((!config.component || !config.module || !config.function || !config.endpointPath || !config.endpointMethod) && !config.sPath)  throw new SError('Missing required config.sPath');

    // Private properties
    let _this     = this;
    _this._S      = Serverless;
    _this._config = {};
    _this.updateConfig(config);

    // Default properties
    _this.path                 = _this._config.sPath.split('@')[1].split('~')[0];
    _this.method               = _this._config.sPath.split('~')[1].toUpperCase();
    _this.type                 = _this._config.type || 'AWS';
    _this.authorizationType    = 'none';
    _this.apiKeyRequired       = false;
    _this.requestParameters    = {};
    _this.requestTemplates     = {};
    _this.requestTemplates['application/json'] = '';
    _this.responses            = {};
    _this.responses['default'] = {
      statusCode: '200',
      responseParameters: {},
      responseModels: {},
      responseTemplates: {}
    };
    _this.responses['default']['responseTemplates']['application/json'] = '';
    _this.responses['400']     = {
      statusCode: '400'
    };
  }

  /**
   * Update Config
   * - Takes config.component, config.module, config.function
   */

  updateConfig(config) {

    if (!config) return;

    // Set sPath
    if (config.component && config.module && config.function && config.endpointPath && config.endpointMethod) {
      this._config.sPath = config.component + '/' + config.module + '/' + config.function + '@' + config.endpointPath + '~' + config.endpointMethod;
    }
    if (config.sPath) {
      this._config.sPath = config.sPath;
    }

    // Make full path
    if (this._S.config.projectPath && this._config.sPath) {
      this._config.fullPath = path.join(
        this._S.config.projectPath,
        this._config.sPath.split('@')[0].split('/').join(path.sep)
      );
    }
  }

  /**
   * Load
   * - Load from source (i.e., file system);
   * - Returns Promise
   */

  load() {

    let _this = this;

    return new BbPromise(function(resolve) {

      // Validate: Check project path is set
      if (!_this._S.config.projectPath) throw new SError('Endpoint could not be loaded because no project path has been set on Serverless instance');

      // Validate: Check function exists
      if (!SUtils.fileExistsSync(path.join(_this._config.fullPath, 's-function.json'))) {
        throw new SError('Endpoint could not be loaded because it does not exist in your project: ' + _this._config.sPath);
      }

      let functionJson = SUtils.readAndParseJsonSync(path.join(_this._config.fullPath, 's-function.json'));
      let endpoint     = null;
      for (let i = 0; i < functionJson.endpoints.length; i++) {
        if (functionJson.endpoints[i].path === _this.path &&
          functionJson.endpoints[i].method === _this.method) {
          endpoint = functionJson.endpoints[i];
        }
      }

      if (!endpoint) throw new SError('Endpoint was not found: ' + _this._config.sPath);

      // Merge
      _.assign(_this, endpoint);

      return resolve(_this);
    });
  }

  /**
   * Set
   * - Set data
   * - Accepts a data object
   */

  set(data) {
    // Merge
    _.assign(this, data);
    return this;
  }

  /**
   * Get
   * - Return data
   */

  get() {
    return SUtils.exportClassData(_.cloneDeep(this));
  }

  /**
   * Get Populated
   * - Fill in templates then variables
   * - Returns Promise
   */

  getPopulated(options) {

    let _this = this;

    options = options || {};

    // Validate: Check Stage & Region
    if (!options.stage || !options.region) throw new SError('Both "stage" and "region" params are required');

    // Validate: Check project path is set
    if (!_this._S.config.projectPath) throw new SError('Endpoint could not be populated because no project path has been set on Serverless instance');

    // Populate
    let clone               = _this.get();
    clone  = SUtils.populate(_this._S.state.getMeta(), _this.getTemplates(), clone, options.stage, options.region);
    return clone;
  }

  /**
   * Get Templates
   * - Returns clone of templates
   * - Inherits parent templates
   */

  getTemplates() {
    return _.merge(
      this.getProject().getTemplates(),
      this.getComponent().getTemplates(),
      this.getFunction().getTemplates()
    );
  }

  /**
   * Save
   * - Saves data to file system
   * - Returns promise
   */

  save() {

    let _this = this;

    return new BbPromise(function(resolve) {

      // Validate: Check project path is set
      if (!_this._S.config.projectPath) throw new SError('Endpoint could not be saved because no project path has been set on Serverless instance');

      // Validate: Check function exists
      if (!SUtils.fileExistsSync(path.join(_this._config.fullPath, 's-function.json'))) {
        throw new SError('Endpoint could not be saved because its function does not exist');
      }

      // Check if endpoint exists, and replace it if so
      let functionJson = SUtils.readAndParseJsonSync(path.join(_this._config.fullPath, 's-function.json'));
      let endpoint = null;
      for (let i = 0; i < functionJson.endpoints.length; i++) {
        if (functionJson.endpoints[i].path === _this.path &&
          functionJson.endpoints[i].method === _this.method) {
          endpoint = functionJson.endpoints[i];
          functionJson.endpoints[i] = _this.get();
        }
      }

      if (!endpoint) functionJson.endpoints.push(_this.get());

      // Save updated function file
      return SUtils.writeFile(path.join(_this._config.fullPath, 's-function.json'), JSON.stringify(functionJson, null, 2))
        .then(resolve);
    });
  }

  /**
   * Get Project
   * - Returns reference to the instance
   */

  getProject() {
    return this._S.state.project;
  }

  /**
   * Get Component
   * - Returns reference to the instance
   */

  getComponent() {

    let components = this._S.state.getComponents({
      paths: [this._config.sPath.split('/')[0]]
    });

    if (components.length === 1) {
      return components[0];
    }

    throw new SError('Could not find component for endpoint');
  }

  /**
   * Get Function
   * - Returns reference to the instance
   */

  getFunction() {

    let functions = this._S.state.getFunctions({
      paths: [this._config.sPath.split('@')[0]]
    });

    if (functions.length === 1) {
      return functions[0];
    }

    throw new SError('Could not find function for endpoint');
  }
}

module.exports = ServerlessEndpoint;

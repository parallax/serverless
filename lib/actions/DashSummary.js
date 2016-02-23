'use strict';

/**
 * Action: DashSummary
 * - Displays a summary of your project stages, regions, components, modules, functions and endpoints
 */

module.exports  = function(SPlugin, serverlessPath) {
  const path    = require('path'),
    SCli        = require(path.join(serverlessPath, 'utils/cli')),
    BbPromise   = require('bluebird');

  /**
   * DashSummary Class
   */

  class DashSummary extends SPlugin {

    constructor(S, config) {
      super(S, config);
    }

    static getName() {
      return 'serverless.core.' + DashSummary.name;
    }

    registerActions() {
      this.S.addAction(this.dashSummary.bind(this), {
        handler:       'dashSummary',
        description:   `Displays a summary of your project stages, regions, components, modules, functions and endpoints`,
        context:       'dash',
        contextAction: 'summary'
      });
      return BbPromise.resolve();
    }

    /**
     * Action
     */

    dashSummary() {

      let _this         = this,
          stages        = _this.S.state.getStages(),
          components    = _this.S.state.getComponents(),
          stagesNum     = 0,
          regionsNum    = 0,
          componentsNum = 0,
          functionsNum  = 0,
          endpointsNum  = 0;

      // Show ASCII
      SCli.asciiGreeting();
      // Blank space for neatness in the CLI
      console.log('');


      // list stages
      SCli.log(`${Object.keys(stages).length} stages ------------------------------`);
      Object.keys(stages).forEach(function(stage) {
        stagesNum++;
        let regions = _this.S.state.getRegions(stages[stage]);
        SCli.log(`    |_ ${stages[stage]} (${regions.length} regions)`);

        // list regions for stage
        Object.keys(regions).forEach(function(region) {
          regionsNum++;
          SCli.log(`        |_ ${regions[region]}`);
        });
      });

      // list components
      console.log('');
      SCli.log(`${components.length} components --------------------------`);

      components.forEach(function(component) {
        componentsNum++;
        SCli.log(`    |_ ${component.name} (${Object.keys(component.functions).length} functions)`);

        // list functions for component
        Object.keys(component.functions).forEach(function(func) {
          functionsNum++;
          SCli.log(`        |_ ${component.functions[func].name} (${Object.keys(component.functions[func].endpoints).length} endpoints)`);

          // list endpoints for function
          Object.keys(component.functions[func].endpoints).forEach(function(endpoint) {
            endpointsNum++;
            SCli.log(`            |_ ${component.functions[func].endpoints[endpoint].method} - ${component.functions[func].endpoints[endpoint].path}`);
          });
        });
      });

      // list summary
      console.log('');
      SCli.log(`SUMMARY -------------------------------`);
      SCli.log(`stages     : ${stagesNum}`);
      SCli.log(`regions    : ${regionsNum}`);
      SCli.log(`components : ${componentsNum}`);
      SCli.log(`functions  : ${functionsNum}`);
      SCli.log(`endpoints  : ${endpointsNum}`);
    }
  }

  return( DashSummary );
};
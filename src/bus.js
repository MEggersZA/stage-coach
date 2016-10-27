'use strict';

/**
 * Module dependencies.
 */

var debug = require('debug')('stage-coach');
var Emitter = require('events').EventEmitter;
var compose_es7 = require('composition');
var compose = require('koa-compose');
var context = require('./context');
var only = require('only');
var assert = require('assert');
var co = require('co');

/**
 * Bus prototype.
 */

var bus = Bus.prototype;

/**
 * Expose `Bus`.
 */

module.exports = Bus;

/**
 * Initialize a new `Bus`.
 *
 * @api public
 */

function Bus() {
  if (!(this instanceof Bus)) return new Bus;
  this.env = process.env.NODE_ENV || 'development';
  this.stageinfo = {};
  this.stageinfo.order = [];  
  this.stages = {};    
  this.currentStage = 'init';  
  this.stageware = this.stages[this.currentStage] = [];
  this.stageinfo[this.currentStage] = { 'buffered' : false, messages : []  };
  this.stageinfo.order.push(this.currentStage);  
  this.context = Object.create(context);    
}

/**
* Inherit from `Emitter.prototype`.
*/

//Object.setPrototypeOf(Bus.prototype, Emitter.prototype);

bus.createMessageQueueHandler = function(stage) {
  
    
    var self = this;
    
    return function *(next){      
      self.stageinfo[stage].messages.push(this.message);
      yield next; 
    }
}

bus.stage = function(stage, buffered) {
  
  var self = this;
  
  buffered = buffered || false;
  
  // If a stage is added as buffered. then middleware is added to the previous stage 
  // which saves messages to be flushed for the buffered stage.
  
  if (buffered === true) {    
    this.use(self.createMessageQueueHandler(stage));    
  }
  
  this.stageware = this.stages[stage] = [];
  this.stageinfo.order.push(stage);
  this.stageinfo[stage] = { 'buffered' : buffered, messages : []  };
  this.currentStage = stage;
};


/**
 * Return JSON representation.
 * We only bother showing settings.
 *
 * @return {Object}
 * @api public
 */


bus.inspect =
bus.toJSON = function(){
  return only(this, [    
    'env',    
    'stages'
  ]);
};


/**
 * Use the given middleware `fn`.
 *
 * @param {GeneratorFunction} fn
 * @return {Application} self
 * @api public
 */

bus.use = function(fn){
  if (!this.experimental) {
    // es7 async functions are allowed
    assert(fn && 'GeneratorFunction' == fn.constructor.name, 'bus.use() requires a generator function');
  }
  debug('use %s', fn._name || fn.name || '-');  
  this.stageware.push(fn);  
  return this;
};

bus.on = function(messageType, fn) {
  this.use(createHandler(messageType, fn));
};

bus.callback = function(stage) {
    
  var fn = compose(this.aggregateMiddleware(stage));
  var self = this;
  
  return function *(message, opts){
        
    var ctx = self.createContext(message, opts);
    
    yield fn.call(ctx); 
    
    return ctx;      
  };
}


bus.dispatch = function *(message, opts) {
  return yield this.stageinfo['init'].callback(message, opts)
    
}


bus.start = function() {
  
    // build callback for each stage
    var stageinfo = this.stageinfo;
    for(var i = 0; i < stageinfo.order.length; i++) {
      var stage = stageinfo.order[i];
      stageinfo[stage].callback = this.callback(stage);                
    }     
}

var createHandler = function(messageType, fn) {
    
    return function *(next){
      
      // messageType
      if (messageType === this.messageType) {
        var args = [];        
        args.push(next);
        yield* fn.apply(this, args);
        return;
      }

      // miss
      return yield* next;
    }
      
};

bus.aggregateMiddleware = function(stage) {
  
  var stages = this.stages;
  var stageinfo = this.stageinfo;
  
  var from = -1; 
  var to = stageinfo.order.length - 1;
  
  for(var i = 0; i < stageinfo.order.length; i++) {
    if (stageinfo.order[i] === stage) {
      from = i;
      break;
    }    
  }
  
  for(var i = from; i < stageinfo.order.length - 1; i++) {
    
    if (stageinfo[stageinfo.order[i + 1]].buffered === true) {
      to = i;
      break;
    }    
  }
  
  if (from === -1) {
    throw new Error('the stage to publish to is not a valid stage')
  }
    
  var middleware = [];
  for(var i = from; i <= to; i++) {
    middleware = middleware.concat(stages[stageinfo.order[i]]);    
  }
  return middleware;
  
},

/**
 * Initialize a new context.
 *
 * @api private
 */

bus.createContext = function(message, opts){
    
    var self = this;

    opts = opts || {};

    var context = Object.create(this.context);
    context.status = 404;
    context.bus = this;
    context.message = message;        
    context.state = opts.state || {};

    // allow additional context proprties to be provided
    var additionalCtx = opts.ctx || {};
    for (var prop in additionalCtx) {
        if (additionalCtx.hasOwnProperty(prop)) {
            if (context.hasOwnProperty(prop)) {
              throw new Error("can't set an existing property on the context ");
            }
            context[prop] = additionalCtx[prop];
        }
    }

    // ensure we can dispatch from context without access to the bus 
    context.dispatch = function *(message, opts, stage) {
      opts = opts || {};
      opts.state =  opts.state || context.state;
      stage = stage || self.stageinfo.order[1];
      return yield self.stageinfo[stage].callback(message, opts)
    };

    context.flush = function *(stage) {      

      for (var i = 0; i < self.stageinfo[stage].messages.length; i++) {
        var m = self.stageinfo[stage].messages[i];
        yield this.dispatch(m, this.opts, stage);
      }
      
    }

    return context;      
};


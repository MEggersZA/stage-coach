'use strict';


/**
 * Context prototype.
 */

var proto = module.exports = {
    
    get messageType() {
      return this.message.messageType;
    },
    
    get reply() {
      return this._reply;
    }, 
    set reply(val) {      
      this._reply = val;
    },
    
    get status() {
      return this._status;
    }, 
    set status(val) {            
      this._status = val;
    }
    
    
};

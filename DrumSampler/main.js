/*!
 * OS.js - JavaScript Operating System
 *
 * Copyright (c) 2011-2014, Anders Evenrud <andersevenrud@gmail.com>
 * All rights reserved.
 * 
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met: 
 * 
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer. 
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution. 
 * 
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * @author  Anders Evenrud <andersevenrud@gmail.com>
 * @licence Simplified BSD License
 */
(function(Application, Window, GUI, Dialogs, Utils) {
  'use strict';

  if ( window.hasOwnProperty('AudioContext') && !window.hasOwnProperty('webkitAudioContext') ) {
    window.webkitAudioContext = AudioContext;
  }

  /////////////////////////////////////////////////////////////////////////////
  // GLOBALS
  /////////////////////////////////////////////////////////////////////////////

  var MIN_TEMPO   = 50;
  var MAX_TEMPO   = 180;
  var MAX_SWING   = 0.08;
  var TRACKS      = 16;
  var INSTRUMENTS = 6;
  var VOLUMES     = [0, 0.3, 1];

  var LABELS      = [
    'Tom 1',
    'Tom 2',
    'Tom 3',
    'Hi-Hat',
    'Snare',
    'Kick'
  ];

  var NULL_BEAT = {
    "kit": null,
    "tempo": 120,
    "effect": null,
    "effectMix": 0.25,
    "swingFactor": 0,
    "instruments": [
      {
        "pitch": 0.5,
        "pattern": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
      },
      {
        "pitch": 0.5,
        "pattern": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
      },
      {
        "pitch": 0.5,
        "pattern": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
      },
      {
        "pitch": 0.5,
        "pattern": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
      },
      {
        "pitch": 0.5,
        "pattern": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
      },
      {
        "pitch": 0.5,
        "pattern": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
      }
    ]
  };

  var DEMO_BEAT = {
    "kit": null,
    "tempo": 120,
    "effect": null,
    "effectMix": 0.25,
    "swingFactor": 0,
    "instruments": [
      {
        "pitch": 0.5,
        "pattern": [0,0,0,0,0,0,0,2,0,2,2,0,0,0,0,0]
      },
      {
        "pitch": 0.5,
        "pattern": [0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0]
      },
      {
        "pitch": 0.5,
        "pattern": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0]
      },
      {
        "pitch": 0.5,
        "pattern": [0,0,0,0,0,0,2,0,2,0,0,0,0,0,0,0]
      },
      {
        "pitch": 0.5,
        "pattern": [0,0,0,0,2,0,0,0,0,0,0,0,2,0,0,0]
      },
      {
        "pitch": 0.5,
        "pattern": [2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
      }
    ]
  };

  /////////////////////////////////////////////////////////////////////////////
  // SAMPLER
  /////////////////////////////////////////////////////////////////////////////

  /**
   * @class
   */
  function Sampler(opts, app) {
    opts = opts || {};
    opts.onNote = opts.onNote || function() {};

    var context = new webkitAudioContext();
    var finalMixNode;
    if ( context.createDynamicsCompressor ) {
      var compressor = context.createDynamicsCompressor();
      compressor.connect(context.destination);
      finalMixNode = compressor;
    } else {
      finalMixNode = context.destination;
    }

    // Create master volume.
    var masterGainNode = context.createGain();
    masterGainNode.gain.value = 0.7; // reduce overall volume to avoid clipping
    masterGainNode.connect(finalMixNode);

    // Create effect volume.
    var effectLevelNode = context.createGain();
    effectLevelNode.gain.value = 1.0; // effect level slider controls this
    effectLevelNode.connect(masterGainNode);

    // Create convolver for effect
    var convolver = context.createConvolver();
    convolver.connect(effectLevelNode);

    this.opts            = opts;
    this.kit             = new Kit('default', app);
    this.context         = context;
    this.masterGainNode  = masterGainNode;
    this.convolver       = convolver;
    this.beat            = DEMO_BEAT;
    this.playing         = false;
    this.timeout         = null;
    this.startTime       = null;
    this.rhythmIndex     = 0;
    this.lastDrawTime    = -1;
    this.noteTime        = 0.0;
  }

  Sampler.prototype.init = function(callback) {
    this.kit.preload(this.context, function() {
      callback();
    });
  };

  Sampler.prototype.destroy = function() {
    this.stop();

    this.kit = null;
    this.beat = null;
  };

  Sampler.prototype.load = function(data) {
    this.stop();
    this.beat = (typeof data === 'string') ? JSON.parse(data) : data;
  };

  Sampler.prototype.reset = function() {
    this.stop();
    this.beat = NULL_BEAT;
  };

  Sampler.prototype.note = function(contextPlayTime, rhythmIndex) {
    var effectDryMix = 1.0;
    var effectWetMix = 1.0;

    var kickPitch = 0;
    var snarePitch = 0;
    var hihatPitch = 0;
    var tom1Pitch = 0;
    var tom2Pitch = 0;
    var tom3Pitch = 0;

    function playNote(buffer, pan, x, y, z, sendGain, mainGain, playbackRate, noteTime) {
      // Create the note
      var voice = this.context.createBufferSource();
      voice.buffer = buffer;
      voice.playbackRate.value = playbackRate;

      // Optionally, connect to a panner
      var finalNode;
      if (pan) {
        var panner = this.context.createPanner();
        panner.setPosition(x, y, z);
        voice.connect(panner);
        finalNode = panner;
      } else {
        finalNode = voice;
      }

      // Connect to dry mix
      var dryGainNode = this.context.createGain();
      dryGainNode.gain.value = mainGain * effectDryMix;
      finalNode.connect(dryGainNode);
      dryGainNode.connect(this.masterGainNode);

      // Connect to wet mix
      var wetGainNode = this.context.createGain();
      wetGainNode.gain.value = sendGain;
      finalNode.connect(wetGainNode);
      wetGainNode.connect(this.convolver);

      voice.start(noteTime);
    }

    var ins = this.beat.instruments;

    // Kick
    if (this.beat.instruments[5].pattern[rhythmIndex]) {
      playNote.call(this, this.kit.buffers.kick, false, 0,0,-2, 0.5, VOLUMES[this.beat.instruments[5].pattern[rhythmIndex]] * 1.0, kickPitch, contextPlayTime);
    }

    // Snare
    if (this.beat.instruments[4].pattern[rhythmIndex]) {
      playNote.call(this, this.kit.buffers.snare, false, 0,0,-2, 1, VOLUMES[this.beat.instruments[4].pattern[rhythmIndex]] * 0.6, snarePitch, contextPlayTime);
    }

    // Hihat
    if (this.beat.instruments[3].pattern[rhythmIndex]) {
      // Pan the hihat according to sequence position.
      playNote.call(this, this.kit.buffers.hihat, true, 0.5*rhythmIndex - 4, 0, -1.0, 1, VOLUMES[this.beat.instruments[3].pattern[rhythmIndex]] * 0.7, hihatPitch, contextPlayTime);
    }

    // Toms
    if (this.beat.instruments[2].pattern[rhythmIndex]) {
      playNote.call(this, this.kit.buffers.tom1, false, 0,0,-2, 1, VOLUMES[this.beat.instruments[2].pattern[rhythmIndex]] * 0.6, tom1Pitch, contextPlayTime);
    }

    if (this.beat.instruments[1].pattern[rhythmIndex]) {
      playNote.call(this, this.kit.buffers.tom2, false, 0,0,-2, 1, VOLUMES[this.beat.instruments[1].pattern[rhythmIndex]] * 0.6, tom2Pitch, contextPlayTime);
    }

    if (this.beat.instruments[0].pattern[rhythmIndex]) {
      playNote.call(this, this.kit.buffers.tom3, false, 0,0,-2, 1, VOLUMES[this.beat.instruments[0].pattern[rhythmIndex]] * 0.6, tom3Pitch, contextPlayTime);
    }

  };


  Sampler.prototype.tick = function() {
    function advanceNote() {
      var secondsPerBeat = 60.0 / this.beat.tempo; // Advance time by a 16th note...

      this.rhythmIndex++;
      if ( this.rhythmIndex === TRACKS ) {
        this.rhythmIndex = 0;
      }

      if ( this.rhythmIndex % 2 ) {
        this.noteTime += (0.25 + MAX_SWING * this.beat.swingFactor) * secondsPerBeat;
      } else {
        this.noteTime += (0.25 - MAX_SWING * this.beat.swingFactor) * secondsPerBeat;
      }
    }


    // The sequence starts at startTime, so normalize currentTime so that it's 0 at the start of the sequence.
    var currentTime = this.context.currentTime;
    currentTime -= this.startTime;

    while ( this.noteTime < currentTime + 0.200) {
      var contextPlayTime = this.noteTime + this.startTime;
      this.note(contextPlayTime, this.rhythmIndex);

      // Attempt to synchronize drawing time with sound
      if ( this.noteTime != this.lastDrawTime ) {
        this.lastDrawTime = this.noteTime;
        var idx = (this.rhythmIndex + 15) % 16;
        this.opts.onNote(idx, this.noteTime);
      }

      advanceNote.call(this);
    }

    var self = this;
    this.timeout = setTimeout(function() {
      self.tick();
    }, 0);
  };

  Sampler.prototype.toggle = function() {
    if ( this.playing ) {
      this.stop();
    } else {
      this.play();
    }
  };

  Sampler.prototype.stop = function() {
    if ( !this.playing ) { return; }

    if ( this.timeout ) {
      clearTimeout(this.timeout);
    }

    this.opts.onNote();

    this.timeout     = null;
    this.playing     = false;
    this.startTime   = null;
    this.rhythmIndex = 0;
    this.noteTime    = 0.0;
  };

  Sampler.prototype.play = function() {
    if ( this.playing ) { return; }
    this.stop();

    if ( !this.context ) {
      throw "Cannot play, no context";
    }

    this.playing   = true;
    this.startTime = this.context.currentTime + 0.005;
    this.noteTime  = 0.0;

    this.tick();
  };

  Sampler.prototype.setNote = function(row, col, state) {
    this.beat.instruments[row].pattern[col] = state;
  };

  Sampler.prototype.getData = function() {
    return JSON.stringify(this.beat);
  };

  /////////////////////////////////////////////////////////////////////////////
  // KITS
  /////////////////////////////////////////////////////////////////////////////


  /**
   * @class
   */
  function Kit(name, app) {
    var rootName = OSjs.API.getApplicationResource(app, "");
    var kitName  = "R8";
    var pathName = rootName + "drum-samples/" + kitName + "/";

    this.paths = {
      kick: pathName  + "kick.wav",
      snare: pathName + "snare.wav",
      hihat: pathName + "hihat.wav",
      tom1: pathName  + "tom1.wav",
      tom2: pathName  + "tom2.wav",
      tom3: pathName  + "tom3.wav"
    };

    this.buffers = {
      kickBuffer: null,
      snareBuffer: null,
      hihatBuffer: null,
      tom1: null,
      tom2: null,
      tom3: null
    };
  }

  Kit.prototype.preload = function(context, cbFinished) {
    var self = this;

    function cbLoaded(err, name, buffer) {
      self.buffers[name] = buffer || null;
    }

    function preload(name, url, callback) {
      var request = new XMLHttpRequest();
      request.open("GET", url, true);
      request.responseType = "arraybuffer";

      request.onload = function() {
        context.decodeAudioData(request.response,
          function(buffer) {
            cbLoaded(false, name, buffer);
            callback();
          },
          function(buffer) {
            cbLoaded("Error decoding sample!");
            callback();
          }
        );
      }

      request.send();
    }

    var list = JSON.parse(JSON.stringify(this.paths));

    function next() {
      var c = null;
      var o = null;
      for ( var i in list ) {
        if ( list.hasOwnProperty(i) ) {
          c = i;
          o = list[i];
          delete list[i];
          break;
        }
      }

      if ( c === null ) {
        cbFinished();
      } else {
        preload(c, o, function() {
          next();
        });
      }
    }

    next();
  };

  /////////////////////////////////////////////////////////////////////////////
  // WINDOWS
  /////////////////////////////////////////////////////////////////////////////

  /**
   * Main Window Constructor
   */
  var ApplicationDrumSamplerWindow = function(app, metadata) {
    var self = this;

    Window.apply(this, ['ApplicationDrumSamplerWindow', {width: 600, height: 240}, app]);

    this.$table        = null;
    this.buttons       = [];
    this.title         = metadata.name + ' v0.1';
    this.sampler       = new Sampler({
      onNote: function(idx, time) {
        self.handleHighlight(idx, time);
      }
    }, app);

    // Set window properties and other stuff here
    this._title = this.title;
    this._icon  = metadata.icon;

    this._properties.allow_resize   = false;
    this._properties.allow_maximize = false;
    this._properties.allow_minimize = true;
  };

  ApplicationDrumSamplerWindow.prototype = Object.create(Window.prototype);

  ApplicationDrumSamplerWindow.prototype.init = function(wmRef, app) {
    var root = Window.prototype.init.apply(this, arguments);
    var self = this;

    var ToggleButton = OSjs.Applications.ApplicationDrumSamplerLibs.ToggleButton;

    // Create window contents (GUI) here
    var menuBar = this._addGUIElement(new GUI.MenuBar('ApplicationDrumSamplerMenuBar', {
      onMenuOpen: function(elem, pos, item) {
        if ( item === 'Play/Pause' ) {
          self.onPlayPressed();
        }
      }
    }), root);
    menuBar.addItem(OSjs._("File"), [
      {title: OSjs._('New'), name: 'New', onClick: function() {
        app.action("new");
      }},
      {title: OSjs._('Load demo track'), name: 'LoadDemo', onClick: function() {
        self.doOpen(null, DEMO_BEAT);
      }},
      {title: OSjs._('Open'), name: 'Open', onClick: function() {
        app.action("open");
      }},
      {title: OSjs._('Save'), name: 'Save', onClick: function() {
        app.action("save");
      }},
      {title: OSjs._('Save As...'), name: 'SaveAs', onClick: function() {
        app.action("saveas");
      }},
      {title: OSjs._('Close'), name: 'Close', onClick: function() {
        app.action("close");
      }}
    ]);

    menuBar.addItem(OSjs._("Play/Pause"));

    function createOnClick(idx, row, col) {
      return function(ev, state) {
        self.onButtonToggle(ev, idx, row, col, state);
      };
    }

    var table = document.createElement('div');
    table.className = 'Table';

    var x, y, row, col, i = 0;
    for ( y = 0; y < INSTRUMENTS; y++ ) {
      row = document.createElement('div');
      row.className = 'Row';

      col = document.createElement('div');
      col.className = 'Col Label';
      col.appendChild(document.createTextNode(LABELS[y]));
      row.appendChild(col);

      for ( x = 0; x < TRACKS; x++ ) {
        col = document.createElement('div');
        col.className = 'Col';
        row.appendChild(col);

        this.buttons.push(this._addGUIElement(new ToggleButton('TrackButton_' + i.toString(), {onClick: createOnClick(i, y, x)}), col));

        i++;
      }

      table.appendChild(row);
    }

    root.appendChild(table);

    this.$table = table;

    return root;
  };

  ApplicationDrumSamplerWindow.prototype._inited = function() {
    Window.prototype._inited.apply(this, arguments);

    // Window has been successfully created and displayed.
    // You can start communications, handle files etc. here
    this.updateTitle();
    this._toggleDisabled(true);

    var self = this;
    this.sampler.init(function() {
      self._toggleDisabled(false);
      self.doDraw();
    });
  };

  ApplicationDrumSamplerWindow.prototype.destroy = function() {
    // Destroy custom objects etc. here
    if ( this.sampler ) {
      this.sampler.destroy();
      this.sampler = null;
    }

    if ( this.$table ) {
      if ( this.$table.parentNode ) {
        this.$table.parentNode.removeChild(this.$table);
      }
      this.$table = null;
    }

    this.buttons = [];

    Window.prototype.destroy.apply(this, arguments);
  };

  ApplicationDrumSamplerWindow.prototype.onPlayPressed = function() {
    if ( this.sampler ) {
      this.sampler.toggle();
    }
  };

  ApplicationDrumSamplerWindow.prototype.onButtonToggle = function(ev, idx, row, col, state) {
    if ( !this.sampler ) { return; }

    this.sampler.setNote(row, col, state);
  };

  ApplicationDrumSamplerWindow.prototype.doDraw = function() {
    if ( !this.sampler ) { return; }
    var b = this.sampler.beat;
    var a, l, j, t = 0;

    for ( var i = 0; i < INSTRUMENTS; i++ ) {
      a = b.instruments[i];
      for ( j = 0; j < TRACKS; j++ ) {
        this.buttons[t].setState(a.pattern[j]);
        t++;
      }
    }
  };

  ApplicationDrumSamplerWindow.prototype.doNew = function() {
    if ( this.sampler ) {
      this.sampler.reset();
    }
    this.doDraw();

    this.updateTitle(null);
  };

  ApplicationDrumSamplerWindow.prototype.doSave = function(filename, data) {
    this.updateTitle(filename);
  };

  ApplicationDrumSamplerWindow.prototype.doOpen = function(filename, data) {
    if ( this.sampler ) {
      this.sampler.load(data);
    }
    this.doDraw();
    this.updateTitle(filename);
  };

  ApplicationDrumSamplerWindow.prototype.updateTitle = function(filename) {
    var name = filename ? Utils.filename(filename) : 'New Beat';
    var title = this.title + ' - ' + name;
    this._setTitle(title);
  };

  ApplicationDrumSamplerWindow.prototype.handleHighlight = function(idx) {
    var i, j;
    for ( i = 0; i < INSTRUMENTS; i++ ) {
      for ( j = 0; j < TRACKS; j++ ) {
        if ( j === idx ) {
          Utils.$addClass(this.$table.childNodes[i].childNodes[j+1], 'Highlight');
        } else {
          Utils.$removeClass(this.$table.childNodes[i].childNodes[j+1], 'Highlight');
        }
      }
    }
  };

  ApplicationDrumSamplerWindow.prototype.getData = function() {
    if ( this.sampler ) {
      return this.sampler.getData();
    }
    return null;
  };

  /////////////////////////////////////////////////////////////////////////////
  // APPLICATION
  /////////////////////////////////////////////////////////////////////////////

  /**
   * Application constructor
   */
  var ApplicationDrumSampler = function(args, metadata) {
    //if ( !OSjs.Compability.audioContext ) {
    if ( !window.webkitAudioContext ) {
      throw 'Your browser does not support AudioContext :(';
    }

    Application.apply(this, ['ApplicationDrumSampler', args, metadata]);

    this.mainWindow = null;

    // You can set application variables here
    this.dialogOptions.mime = 'osjs/dbeat';
    this.dialogOptions.mimes = metadata.mime;
    this.dialogOptions.defaultFilename = 'New Beat.odbeat';
  };

  ApplicationDrumSampler.prototype = Object.create(Application.prototype);

  ApplicationDrumSampler.prototype.destroy = function() {
    // Destroy communication, timers, objects etc. here

    return Application.prototype.destroy.apply(this, arguments);
  };

  ApplicationDrumSampler.prototype.init = function(settings, metadata) {
    Application.prototype.init.apply(this, arguments);

    this.mainWindow = this._addWindow(new ApplicationDrumSamplerWindow(this, metadata));
  };

  ApplicationDrumSampler.prototype._onMessage = function(obj, msg, args) {
    Application.prototype._onMessage.apply(this, arguments);

    // Make sure we kill our application if main window was closed
    if ( msg == 'destroyWindow' && obj._name === 'ApplicationDrumSamplerWindow' ) {
      this.destroy();
    }
  };

  ApplicationDrumSampler.prototype.onNew = function() {
    if ( this.mainWindow ) {
      this.mainWindow.doNew();
      this.mainWindow._focus();
    }
  };

  ApplicationDrumSampler.prototype.onOpen = function(filename, mime, data) {
    if ( this.mainWindow ) {
      this.mainWindow.doOpen(filename, data);
      this.mainWindow._focus();
    }
  };

  ApplicationDrumSampler.prototype.onSave = function(filename, mime, data) {
    if ( this.mainWindow ) {
      this.mainWindow.doSave(filename, data);
      this.mainWindow._focus();
    }
  };

  ApplicationDrumSampler.prototype.onGetSaveData = function(callback) {
    var data = '';
    if ( this.mainWindow ) {
      data = this.mainWindow.getData();
    }
    callback(data);
  };

  //
  // EXPORTS
  //
  OSjs.Applications = OSjs.Applications || {};
  OSjs.Applications.ApplicationDrumSampler = ApplicationDrumSampler;

})(OSjs.Helpers.DefaultApplication, OSjs.Core.Window, OSjs.GUI, OSjs.Dialogs, OSjs.Utils);

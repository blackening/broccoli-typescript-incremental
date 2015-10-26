//This is based heavily off https://github.com/theblacksmith/typescript-require/blob/master/index.js

var ts;
try{
	ts = require('typescript');
}catch(e){
	console.error('Ensure that typescript is installed in the project directory');
	throw e;
}
var _ = require('lodash');
var Plugin = require('broccoli-plugin');
var path = require('path');
var fs = require('fs-extra');
var glob = require('glob');


BroccoliTSC.prototype = Object.create(Plugin.prototype);
BroccoliTSC.prototype.constructor = BroccoliTSC;
function BroccoliTSC(inputNode, options){
	if (!(this instanceof BroccoliTSC))
    return new BroccoliTSC(inputNode, options);
	options = options || {};
	Plugin.call(this, [inputNode], {
		annotation: options.annotation
	});
	this.options = options;
};

/* Available properties:
this.inputPaths - array of paths on disks corresponding to inputNodes.
this.outputPath - Path to write to.
this.cachePath - Cache for me to use.
*/
BroccoliTSC.prototype.build = function(){
	try{
		this.getLanguageService(this.cachePath, this.options);
		this.options.outDir = this.outputPath;
		console.log('Processing', this.inputPaths);
		var languageServiceHost = this.languageServiceHost;
		_.each(this.inputPaths, function(path){
				var files = glob.sync(path+'/**/*', {nodir: true});
				_.each(files, function(file){
					languageServiceHost.addFile(file);
				});
		});
		console.log('----- Generating files -----')
		//TODO: Should i clear all non-recent files?
		_.each(this.inputPaths, function(path){
			if(this.options.passthrough){
				console.log('Passthrough:', path);
				fs.copySync(path, this.outputPath);
			}
			var files = glob.sync(path+'/**/*', {nodir: true});
			_.each(files, function(file){
				if(this.toProcess(file)){
					console.log('processing', file)
					var output = this.generateOutput(file);
					this.saveOutput(output);
				}
				else if(!this.options.passthrough){
					console.log('Ignoring file:', file);
				}
			}, this);
		}, this);
		this.serializeLanguageService(this.cachePath);
	} catch(e){
		console.log(e.message);
		console.log(e.stack);
		throw e;
	}
}

BroccoliTSC.prototype.toProcess = function(path){
	return path.substr(path.length - 3) == '.ts' && path.substr(path.length - 5) != '.d.ts';
}


BroccoliTSC.prototype.serializeLanguageService = function(path){
	var files = this.languageServiceHost.files;
	fs.writeFileSync(this.cachePath+'/files.json', JSON.stringify(files));
	console.log('Caching to:', this.cachePath+'/files.json');
}

BroccoliTSC.prototype.deserializeLanguageService = function(path){
	if(!fs.existsSync(this.cachePath+'/files.json'))
		return;
	var restored_files = JSON.parse(fs.readFileSync(this.cachePath+'/files.json')) || {};
	_.each(restored_files, function(file, path){
		file.changed = false;
		console.log(path, file);
		this.languageServiceHost.files[path] = file;
	}, this);
}

BroccoliTSC.prototype.generateOutput = function(inputPath){
	if(!this.languageServiceHost.hasChanged(inputPath))
		return this.languageServiceHost.getCache(inputPath);
	var output = this.services.getEmitOutput(inputPath);
	if (!output.emitSkipped) {
		console.log('Emitting', inputPath);
	}
	else {
		console.log('Emitting', inputPath, 'failed');
		this.logErrors(inputPath);
	}
	//cache the output
	this.languageServiceHost.setCache(inputPath, output);
	return output;
}

BroccoliTSC.prototype.saveOutput = function(output){
	output.outputFiles.forEach(function(out){
		console.log('Writing', out.name);
		fs.outputFileSync(out.name, out.text, "utf8");
	});
}

BroccoliTSC.prototype.logErrors = function(fileName){
	var allDiagnostics = services.getCompilerOptionsDiagnostics()
		.concat(services.getSyntacticDiagnostics(fileName))
		.concat(services.getSemanticDiagnostics(fileName));

	allDiagnostics.forEach(function(diagnostic){
		var message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
		if (diagnostic.file) {
			var err = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
			var line = err[0];
			var character = err[1];
			console.log(diagnostic.file.filename, line+1, character+1, message);
		}
		else {
			console.log('Error:', message);
		}
	});
}

/* Attempts to deserialize a language service, if possible.
If not, simply creates a new one.
*/
BroccoliTSC.prototype.getLanguageService = function(path, options){
	this.createLanguageService(options);
	this.deserializeLanguageService(path);
}

BroccoliTSC.prototype.createLanguageService = function(options){
	this.languageServiceHost = new LanguageServiceHost(options);
	this.services = ts.createLanguageService(this.languageServiceHost, ts.createDocumentRegistry());
	//TODO: Check if createDocumentRegistry is serializable.
}

function LanguageServiceHost(options){
	this.files = {};
	this.options = options;
};

LanguageServiceHost.prototype.getScriptFileNames = function(){
	return _.map(this.files, function(file){
		return file.rootFileName;
	});
}

LanguageServiceHost.prototype.getScriptVersion = function(filename){
	return this.files[filename] && this.files[filename].version.toString();
}


LanguageServiceHost.prototype.getScriptSnapshot = function(filename){
	console.log('getting snapshot', filename);
	if (!fs.existsSync(filename))
		return undefined;
	return ts.ScriptSnapshot.fromString(fs.readFileSync(filename).toString());
}

LanguageServiceHost.prototype.getCurrentDirectory = function(){
	return process.cwd();
}

LanguageServiceHost.prototype.getCompilationSettings = function(){
	return this.options;

}
LanguageServiceHost.prototype.getDefaultLibFileName = function(options){
	return ts.getDefaultLibFilePath(options);
}

/* Should version the file. */
LanguageServiceHost.prototype.addFile = function(path){
	var last_modified = fs.statSync(path).mtime.toJSON();
	if(this.files[path]){
		console.log(this.files[path].last_modified, last_modified);
		if(this.files[path].last_modified != last_modified){
			this.files[path].version += 1;
			this.files[path].last_modified = last_modified;
			this.files[path].changed = true;
		}
	}
	else
		this.files[path] = {
			version: 0,
			last_modified: last_modified,
			rootFileName: path,
			changed: true
		}
}

LanguageServiceHost.prototype.getCache = function(path){
	return this.files[path].cached;
}

LanguageServiceHost.prototype.setCache = function(path, output){
	this.files[path].cached = output;
}

//Assumes no infinite dependency loop.
LanguageServiceHost.prototype.hasChanged = function(filepath){
		//TODO: figure out what readImportFiles does. Does it recursive?
	if(this.files[filepath].changed)
		return true;
	var basepath = path.dirname(filepath);
	var preprocessed = ts.preProcessFile(fs.readFileSync(filepath).toString(), true);
	var relative_dependencies = _(preprocessed.referencedFiles).map(function(file) { return file.fileName });
	var absolute_dependencies = relative_dependencies
		.map(function(r_path) { return path.resolve(basepath, r_path)})
		.map(function(abs_path){ return abs_path.replace(/\\/g,"/")});
	return absolute_dependencies.some(this.hasChanged, this);
}


module.exports = BroccoliTSC;

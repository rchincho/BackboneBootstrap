/*globals define console, app*/

define( [
    'jquery', 'lodash', 'backbone',
    'src/models/mixins/dateFormatterModelMixin',
    'src/utils/models/modelHelper',
    'src/utils/models/FieldCollection',
    'src/utils/convert', 'src/utils/string',
    'src/utils/mixins/escapeDeep',
    'src/utils/mixins/findBy'
  ], function(
    $, _, Backbone,
    modelMixin,         // dateFormatterModelMixin
    modelHelper,
    FieldCollection,
    convert, string,
    escapeDeep,
    findBy
  ) {

'use strict';

/**
 * BaseModel provides basic functionality common to every application model.
 *
 * Unlike Backbone's models, BaseModel is aware of the fields of the model,
 * and is able to apply validations when saving them.
 *
 * If has a FieldCollection with all the information neccsary to process the
 * fields.
 *
 * Errors are saved in this.errors array, with the following structure:
 *
 * this.error: [
 *   { field: '', message: 'The record was modified by another person' },
 *   { field: 'code', message: 'The code cannot be empty' }
 * ];
 *
 * It can also gracefully handle and report client-side validations and
 * server-side errors in a consistent way.
 *
 * Client-side validations are processed by this.validate method, before
 * sending them to the server. After validating them (wether successfully or
 * not) a 'validate' event is triggered. If there was any failing client-side
 * validation no further processing is done, the errors are kept in this.errors
 * and this.isValid() returns false.
 *
 * If no client-side validation failed, the model is saved by calling
 * (Backbone.Model#save)[http://backbonejs.org/#Model-save]
 *
 * In case of a server error, the web service should return the errors
 * according to the previous structure, along with a non-200 HTTP response code.
 *
 * In that case, the xhr response from the server is proccessed by
 * BaseModel#_setServerErrors, which saves it to the responseError property,
 * parses the serverErrors array, updates each field with the server error, and
 * finally triggers a 'validate' event.
 *
 * This is the flow of a normal update:
 *
 * - model.save is executed
 *
 * client-side validations
 * - model.validate() is called
 * - each field is validated with field.validate and a field 'validate' event is
 *   triggered
 * - model.errors is updated accordingly
 * - a model 'validate' event is triggered, passing the errors array as
 *   parameter
 * - if there was any client-side validations error,
 *   no further processing is issued
 * - if there was no error, Backbone.Model#save is called
 *
 * server-side errors
 * - if there were no errors, no further processing is issued
 * - if there were errors, BaseModel#_setServerErrors is called
 * - _setServerErrors parses the xhr error response and saves it to serverErrors
 *   array
 * - each field is updated with the serverErrors array and a field 'validate'
 *   event is triggered
 * - BaseModel#serverErrors array is copied to BaseModel#errors
 * - a model 'validate' event is triggered, passing the errors array as
 *   parameter
 *
 * @class BaseModel
 * @extends Backbone.model
 *
 * See
 *
 * - (Backbone.Model)[http://backbonejs.org/#Model]
 * - (Backbone.Model#save)[http://backbonejs.org/#Model-save]
 * - BaseModel.save
 * - BaseModel._setServerErrors
 *
 */
var BaseModel = Backbone.Model.extend({

  defs: {
    name          : undefined,
    label         : undefined,
    fields        : undefined,
    formFields    : undefined,
    queryFields   : undefined,
    tableFields   : undefined,
    headerFields  : undefined,
    errors        : [],                 // shadow prototype errors array
    responseError : null,
    serverErrors  : []                  // shadow prototype serverErrors array
  },

  // see: http://momentjs.com/docs/#/parsing/string/
  backendDateFormat: 'YYYY-MM-DDTHH:mm:ss[Z]',  // ISO-8601

  // backendDateFormat: undefined,

  initialize: function(attrs) {

    _.defaults(this, this.defs);

    // this.backendDateFormat =
    //   this.backendDateFormat || (app ? app.backendDateFormat : undefined);

    // if (this.backendDateFormat) {
    //   modelMixin.dateFormatterModel(this, this.backendDateFormat);
    // }

    this.initFields();

    this.label = this.label || this.name;

    // debug
    //var backend = this.rawToBackend({ Fundacion: new Date() });
    //var raw = this.backendToRaw(backend);

    Backbone.Model.prototype.initialize.call(this, attrs);

    return this;
  },

  setFields: function(fields) {
    if (!fields instanceof FieldCollection) throw new Error('fields should be a FieldCollection');

    this.fields = fields;
    this.fields.setModel(this);     // bind fields to this model
  },

  entityID: function() {
    return this.idAttribute ? this.attributes[this.idAttribute] : this.id;
  },

  /**
   * Saves the model to the database by calling the web service.
   *
   * First it calls BaseModel#validate() to run client-side validations.
   *
   * The it register two callbacks (options.success and options.error) to stop
   * the loading indicator (toaster) and to call BaseMode#_setServerErrors to
   * proccess server-side errors.
   *
   * Finally it calls Backbone.Model#save
   *
   * @param  {Object} attributes Attributes of the model to update.
   * @param  {Object} options    Options for Backbone.Model#save
   * @return {[type]}            [description]
   *
   * @override
   *
   * See
   *
   * - (Backbone.Model#save)[http://backbonejs.org/#Model-save]
   */
  save: function(attributes, options) {
    var self = this;

    // clear server errors
    this._setServerErrors(null);

    // run client-side validations and if there's any validation error
    // stop processing without even calling super.save
    // (and avoid troubles with the app.completeLoading stuff)
    // validate returns null if there's no error
    if (_.isFunction(this.validate) && this.validate()) return;

    // override success callback
    // stop loading indicator (toaster)
    // clear error state (responseError, serverErrors)
    // and finally call original callback, if specified
    var success = options.success;
    options.success = function(model, response, opt) {
      // Remove process to show
      app.completeLoading();

      self._setServerErrors(null);

      // call success callback from options
      if (success) return success(model, response, opt);
    };

    // override error callback
    // stop loading indicator (toaster)
    // process errors from server
    // and finally call original callback, if specified
    var error = options.error;
    options.error = function(model, xhr, opt) {
      // Remove process to show
      app.completeLoading();

      self._setServerErrors(xhr);

      if (error) return error(model, xhr, opt);
    };

    // don't validate again, we've already validated on the client side
    options.validate = false;

    // Add process to show
    app.startLoading('Grabando cambios...');

    //super.save(attributes, overrideOptions)
    return Backbone.Model.prototype.save.call(this, attributes, options);
  },

  /**
   * Read and process server errors.
   *
   * This method will process the XmlHttpRequest returned by a failed called to
   * the web service.
   *
   * Then it will saves the xhr to this.response, parses the serverErrors, and
   * saves them to this.serverErrors.
   *
   * It will also call setServerError on each field passing the serverErrors
   * array, so that each field updates it's error status (each field will also
   * trigger a validate event).
   *
   * Finally the model will update the errors array with the errors from the
   * server and trigger a 'validate' event.
   *
   * @param  {XmlHttpRequest|null} response [description]
   * @return {[type]}          [description]
   */
  _setServerErrors: function(response) {

    // no error, clear server errors properties
    if (!response) {
      this.responseError = null;
      this.serverErrors = [];
      return this;
    }

    this.responseError = response;
    this.serverErrors = $.parseJSON(this.responseError.responseText);

    // it's not an array, it's just an error, transform it into an array
    if (_.has(this.serverErrors, 'field') ||
        _.has(this.serverErrors, 'message')
    ) {
      this.serverErrors = [this.serverErrors];
    }

    // add a first error
    var firstError = { field: '', message: 'Los cambios no han sido guardados.' };
    this.serverErrors.splice(0, 0, firstError);

    // update each field with the errors from the server
    // this will trigger validate event for each field
    _.each(this.fields, function(field) {
      field.setServerErrors(this.serverErrors);
    }, this);

    this.errors = this.serverErrors;

    this.trigger('validate', this.errors);

    return this;
  },

/**
 * Array of field definition to be displayed in edit mode
 * This information is used to instantiate a FieldsCollection
 * example: formFields: [
 *   {name: 'id', readOnly: true, label: 'Id', help: 'Automatically generated' },
 *   {name: 'name', span: 6, label: 'Name', help: 'Enter your name' },
 *   {name: 'comment', span: 8, label: 'Comment', help: 'Enter your comment', control: 'textarea', rows: 4 }
 *   ...
 * ]
 */

  /**
   * Validates the specified field.
   *
   * First it clear all the errors for the speficied fields, then it validates
   * the field and finally it adds those errors to the model's error collection.
   *
   * @param  {Field} field    The field to validate.
   * @return {boolean}        True if the field is valid.
   */
  validateField: function(field) {

    if (!this.fields.findByName(field.name)) throw new Error('Could not find a field with name "' + field + "'.");

    // remove all errors for this field
    this.errors = _.reject(this.errors, function(error) {
      return error.field === field.name;
    });

    field.validate();

    // add the errors of this field
    if (field.error) this.errors = _.union(this.errors, field.errors);

    return field.isValid();
  },

  /**
   * Perform client-side validations.
   *
   * This method executes this.validaField for every field, and then triggers
   * a 'validate' event (each field will also trigger it's own validate event).
   *
   * If any error is found, a general error will be added to the errors array
   * stating that the changes were not saved.
   *
   * If no error is found, the method returns null, which is the value expected
   * by Backbone.Model.validate.
   *
   * This method is called from BaseModel.save. If any client-side error is
   * found further processing is stopped, without even calling
   * Backbone.Model.save.
   *
   * @return {null|Array<Object>}   Returns null if no client-side error is found.
   *                                Otherwise it returns the array of errors.
   *
   * @override
   *
   * See
   *
   * - [Backbone.Model#validate](http://backbonejs.org/#Model-validate)
   */
  validate: function() {

    // clear errors collection, check http://stackoverflow.com/questions/1232040/how-to-empty-an-array-in-javascript
    this.errors.length = 0;

    // run every validation for every field
    // and return false if anyone failed
    _.each(this.fields, function(field) {
      this.validateField(field);
    }, this);

    // return errors, let backbone cancel everything
    if (!this.isValid()) {
      // insert general error
      var firstError = { field: '', message: 'El formulario contiene errores. Revise la información ingresada.' };
      this.errors.splice(0, 0, firstError);
      // trigger model's validate event
      this.trigger('validate', this.errors);
      return this.errors;
    }

    this.trigger('validate', this.errors);

    // if no error is found, Backbone expects a null value
    return null;
  },

  /**
   * Return the errors of the specified field.
   *
   * Passing a falsy value will return the errors not associated with any field.
   *
   * @param  {Field|string|falsy}   field   The Field object, a string with the
   *                                        the field name or a falsy value to
   *                                        get the errors of the model.
   * @return {Array<Object>}        An array with the errors of the field.
   */
  errorsByField: function(field) {
    var name = (!field) ? '' : (_.isString(field) ? field : field.name);
    return _.filter(this.errors, function(error) {
      return error.field === name;
    });
  },

  isValid: function() {
    return this.errors.length === 0;
  },

  /**
   * Returns true if it´s a new model.
   *
   * Overrides Backbone's isNew because we may have a
   * default value for new records.
   *
   * If this.id is not a number, then assume it's a new record
   *
   * @override
   *
   * @return {Boolean} True if it's a new record.
   */
  isNew: function() {
    return (!convert.isNumeric(this.id));
  },

  escapeJSON: function() {
    var json = this.toJSON();

    _.each(json, function(value, key) {
      json[key] = this.escape(key);
    }, this);
    return json;
  },

  displayAttrs: function(escaped) {
    // var attrs = _.clone(this.attributes);
    var attrs = {};

    escaped = (escaped === undefined ? true : escaped);

    _.each(this.fields, function(field) {

      var value = field.val(),
          name = field.name;

      if (field && _.isFunction(field.display)) {
        attrs[name] = field.display(value, this.attributes, field);
      } else {
        attrs[name] = value;
      }

      // escape deep is used for escaping nested objects
      if (escaped) attrs[name] = _.escapeDeep(attrs[name]);
    }, this);

    return attrs;
  },

  /**
   * Initiate each field definition collection.
   *
   * It takes this.fields and saves it as schema.
   *
   * Then it tries to instantiate a FieldCollection for every fields definition
   * property. Currently it supports:
   *
   * fields: the list of fields to use as a base.
   *
   * formfields: fields to use for update and edit form.
   *
   * queryFields: fields to use to filter data.
   *
   * tableFields: columns to show in the grid.
   *
   * headerFields: fields to show on the master panel of a detail crud page.
   *
   * @chainable
   */
  initFields: function() {
    var key, value;
    this.schema = _.clone(this.fields);

    for(key in this) {
      value = this[key] || [];

      // field should be suffixed with fields
      if (key !== 'fields' && !string.endsWith(key, 'Fields')) continue;

      // it should be a plain object - skip setFields methods and similar stuff
      if (!_.isArray(value)) continue;

      // finnally process this field
      this[key] = this.instantiateFields(this.schema, value);
      this[key].setModel(this);
    }
    return this;
  },

  /**
   * It completes the fields definition useing baseFields values, and then
   * instantiates a new FieldCollection.
   *
   * @param  {Array<Object>} baseFields Array of field definitions expressed as
   *                                    javascript plain objects to use as base.
   *                                    It usually is the fieldsDefinition
   *                                    property.
   * @param  {Array<Object>} newFields  Array of field definitions expressed as
   *                                    javascript plain objects to override the
   *                                    base definition.
   *
   * @return {FieldCollection}          The newly instantiated field collection
   *                                    using the settings from baseFields
   *                                    overriden by newFields.
   */
  instantiateFields: function(baseFields, newFields) {
    var fieldsToInstantiate = [],
        fieldToInstantiate;

    newFields = newFields || [];

    _.each(newFields, function(newField) {

      // if it's just the field name, transform it to a field definition
      if (_.isString(newField)) newField = { name: newField };

      // look for the base definition corresponding to this field
      var baseField = _.findBy(baseFields, 'name', newField.name);
      // var baseField = _.find(baseFields, function(baseField) {
      //   return baseField.name === newField.name;
      // });

      if (!baseField) {
        console.log(baseFields); console.log(newFields);
        throw new Error('could not find field "' + newField.name + '" in fields definition.');
      }

      // overwrite baseField with newField definition
      fieldToInstantiate = _.extend({}, baseField, newField);

      // add the new field
      fieldsToInstantiate.push(fieldToInstantiate);
    });

    return new FieldCollection(fieldsToInstantiate);
  },

  parse: function(response) {
    if (_.isFunction(this.backendToRaw)) return this.backendToRaw(response);
    return response;
  },

  sync: function(method, model, options) {
    if (_.isFunction(this.rawToBackend)) {
      model.set(this.rawToBackend(model.attributes));
    }
    return Backbone.Model.prototype.sync.call(this, method, model, options);
  },

  /**
   * Parses the raw response in a hash of javascript raw types.
   *
   * This is the place to handle conversion from your web service output to
   * normal javascript types.
   *
   * It will be used by the overriden parse method.
   *
   * @param  {[type]} response [description]
   * @return {[type]}          [description]
   */
  backendToRaw: function(response) {
    return response;
  },

  /**
   * Converts a hash of attributes to the format required by the backend.
   *
   * This is the place to handle conversion normal javascript types to your web
   * service expected input.
   *
   * It will be used by the overriden Backbone.Sync method.
   *
   * @param  {[type]} attrs [description]
   * @return {[type]}          [description]
   */
  rawToBackend: function(attrs) {
    return attrs;
  }

});

// overwrite extend method to enhance field definitions afer extending
// enhance field definitions when extending from the base class
BaseModel.extend = function(options) {
  // first call the original extend method to get the new Model constructor
  var ExtendedModel = Backbone.Model.extend.apply(this, arguments);

  // and then, call our modelHelper to extend field definitions of the new constructor
  // modelHelper.enhanceModelFields(ExtendedModel);
  modelHelper.completeModelDefaults(ExtendedModel);

  var backendDateFormat =
    ExtendedModel.prototype.backendDateFormat ||
    (app ? app.backendDateFormat : undefined) ||
    undefined;

  if (backendDateFormat) {
    modelMixin.dateFormatterModel(ExtendedModel.prototype, backendDateFormat);
  }

  return ExtendedModel;
};

  return BaseModel;
});

/*globals $,_,Backbone,src:true,utils,confirm,alert*/

'use strict';
var src = src || {};
src.routers = src.routers || {};

src.routers.wine = Backbone.Router.extend({

  routes: {
    '':                         'list',
    'wines':                    'list',
    'wines?*url':               'list',
    'wines/new':                'edit',
    'wines/del/:id':            'del',
    'wines/:id':                'edit',
    'errors':                   'testErrors'
  },

  initialize: function() {
    _.bindAll(this, 'test');
    //new src.views.widgets.MainMenuView({el: '#main-menu'}).render();
    $('#main-menu-view').replaceWith($('#main-menu-template').html());
    $('#toolbar-view').replaceWith($('#action-bar-template').html());
    $('#accessibility-view').replaceWith($('#accessibility-bar-template').html());
    $('#tabs-view').replaceWith($('#tabs-bar-template').html());
    $('#messages-view').replaceWith($('#messages-template').html());

    this.collection = new src.models.Wines();
    this.model = undefined;

    new src.views.crud.TableView({
      el: '#table-view', collection: this.collection
    }).render();

    new src.views.wine.RowsView({
      el: '#table-view tbody', collection: this.collection
    });

    //this.collection.fetch();

    Backbone.history.start();
  },

  list: function(query) {
    this.collection.setParams(utils.http.parseQuery(query));

    this.collection.fetch();
    $('#form-view').show();
  },

  edit: function(id) {
    this.model = id ? this.collection.get(id) : new src.models.Wine();
    
    new src.views.wine.FormView({
      el: '#form-view', model: this.model, collection: this.collection
    }).render();
  },

  del: function(id) {
    this.model = this.collection.get(id);
    if (!this.model) {
      alert('Item not found');
      this.navigate('wines', {trigger: true});
      return;
    }
    if (confirm('are you sure you want to delete the current record?')) {
      var that = this;
      this.model.destroy({success: function() {
        that.navigate('wines', {trigger: true});
      }});
      return;
    } else {
      this.navigate('wines', {trigger: false});
    }
  },

  testErrors: function() {
    this.collection.fetch({
      success: this.test
    });
  },

  test: function() {
    this.model = this.collection.at(1);
    
    new src.views.wine.FormView({
      el: '#form-view', model: this.model, collection: this.collection
    }).render();

    // mock response
    var response = {
      responseText: '\
[\
{"field":"","errorCode":10000,"status":400,"developerMessage":"Error performing operation","message":"General error"},\
{"field":"name","errorCode":10000,"status":400,"developerMessage":"Error performing operation","message":"Name not specified"},\
{"field":"name","errorCode":10000,"status":400,"developerMessage":"Error performing operation","message":"Another error for name"},\
{"field":"year","errorCode":10000,"status":400,"developerMessage":"Error performing operation","message":"Year can\'t be greater than current year"}\
]'
    };
    var err = new ErrorManager({
      response: response,
      el: 'div#form-view'
    });
    err.render();
  },

  routeWith: function(params) {
    return utils.http.addParams(Backbone.history.getHash(), params);
  },

  navigateWith: function(params, options) {
    this.navigate(this.routeWith(params), options);
  }

});
self.importScripts('https://cdnjs.cloudflare.com/ajax/libs/lunr.js/2.1.6/lunr.min.js');

var l;
var recipes;
var recipesById;

self.addEventListener("message", function(e) {
  var message = JSON.parse(e.data);
  if (message.op === 'init') {
    recipes = message.data;
    
    recipes = recipes.map(function(el) {
      if (el.labels.length > 0) {
        el.labels_flatlist = el.labels.map(function(label) {
          return label.title;
        }).join(', ');
      } else {
        el.labels_flatlist = '';
      }
      return el;
    });
    
    recipesById = recipes.reduce(function(map, el) {
      map[el._id] = el;
  	  return map;
    }, {});
    
    l = lunr(function () {
      this.ref('_id');
      this.field("title");
      this.field("description");
      this.field("source");
      this.field("ingredients");
      this.field("instructions");
      this.field("notes");
      this.field("labels_flatlist");
    
      recipes.forEach(function (recipe) {
        this.add(recipe);
      }, this);
    });
  } else if (message.op === 'search') {
    if (message.data.trim().length > 0) {
      var results = l.search(message.data);
      
      results = results.map(function(el) {
        var recipe = recipesById[el.ref];
        recipe.score = el.score;
        return recipe;
      });
      
      postMessage(JSON.stringify({
        op: 'results',
        data: results
      }));
    } else {
      postMessage(JSON.stringify({
        op: 'results',
        data: recipes
      }));
    }
  }
}, false);
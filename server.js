var express = require('express'),
    app = express(),
    bodyParser = require('body-parser'),
    MongoClient = require('mongodb').MongoClient,
    engines = require('consolidate'),
    assert = require('assert'),
    ObjectId = require('mongodb').ObjectID,
    url = 'mongodb://c4tssg2:uVIMgFJOLZ7nFPTCqavJakAJRwVsBvOJINWqFzpIRcY6oEuCAaa5uykPVMt1eLxnSti6cOts44GbDXcX8s4gkg%3D%3D@c4tssg2.documents.azure.com:10255/?ssl=true',
    collectionName = 'records',
    redis = require("redis"),
    redisHostName = 'c4tssg2cache.redis.cache.windows.net',
    redisKey = '9PjAetiA3jfHheZEF6erkKcMBqpw9IEdK9c5vvqS4Xk=';

app.use(express.static(__dirname + "/public"));

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

app.engine('html', engines.nunjucks);
app.set('view engine', 'html');
app.set('views', __dirname + '/views');

function errorHandler(err, req, res, next) {
    console.error(err.message);
    console.error(err.stack);
    res.status(500).render("error_template", { error: err});
}

MongoClient.connect(process.env.MONGODB_URI || url,function(err, db){
    assert.equal(null, err);
    console.log('Successfully connected to MongoDB');

    var records_collection = db.collection(collectionName);
    console.log("DB collection ready for: " + collectionName);
    
    var cache = redis.createClient(6380, redisHostName, 
        {auth_pass: redisKey, tls: {servername: redisHostName}});
    console.log("Cache ready for: " + redisHostName);

    app.get('/records', function(req, res, next) {
        console.log("Received get /records request");
        
        cache.HGETALL(collectionName, function(err, reply) {
            if(err) throw err;
            else if(reply) {
                // cache returns a hashtable object (_id : stringified record object)
                var records = Object.values(reply);
                console.log("Cache hit, reply size: " + records.length);
                // convert record string to object
                for(var i = 0; i < records.length; i++) {
                    records[i] = JSON.parse(records[i]);
                }
                res.json(records);
            }
            else {
                console.log("Cache miss");
                //var options = {};
                //options["limit"] = 20;
                //options["skip"] = 0;
                //records_collection.find({}, options).toArray(function(err, records){
                records_collection.find({}).toArray(function(err, records){
                    if(err) throw err;
            
                    console.log("Number of records from DB: " + records.length);
                    //console.log(records);
                    res.json(records);

                    // write to cache as hashtable, key is _id, value is the record object
                    var i, hashList = [];
                    for(i = 0; i < records.length; i++) {
                        hashList[2 * i] = records[i]._id.toString();
                        hashList[2 * i + 1] = JSON.stringify(records[i]);
                    }
                    cache.HMSET(collectionName, hashList);
                    console.log("Cache set successfully");
                });
            }
        });
    });

    app.post('/records', function(req, res, next){
        console.log("Received create request for: " + JSON.stringify(req.body));
        records_collection.insert(req.body, function(err, doc) {
            if(err) throw err;
            console.log(doc);
            res.json(doc);

            // update cache
            var insertedId = doc.insertedIds[0];
            var insertedRecord = doc.ops[0];
            cache.HSET(collectionName, insertedId.toString(), JSON.stringify(insertedRecord));
        });
    });

    app.delete('/records/:id', function(req, res, next){
        var id = req.params.id;
        console.log("Received delete request for: " + id);
        records_collection.deleteOne({'_id': new ObjectId(id)}, function(err, results){
            if(err) throw err;
            //console.log(results);
            res.json(results);

            // update cache
            cache.HDEL(collectionName, id.toString());
        });
    });

    app.put('/records/:id', function(req, res, next){
        var id = req.params.id;
        console.log("Received update request for: " + id);
        records_collection.updateOne(
            {'_id': new ObjectId(id)},
            { $set: {
                'name' : req.body.name,
                'email': req.body.email,
                'phone': req.body.phone
                }
            }, function(err, results){
                if(err) throw err;
                //console.log(results);
                res.json(results);

                // update cache
                var updatedRecord = {'_id' : id,
                    'name' : req.body.name,
                    'email': req.body.email,
                    'phone': req.body.phone};
                cache.HSET(collectionName, id.toString(), JSON.stringify(updatedRecord));
        });
    });

    app.use(errorHandler);
    var server = app.listen(process.env.PORT || 3000, function() {
        var port = server.address().port;
        console.log('Express server listening on port %s.', port);
    })
})

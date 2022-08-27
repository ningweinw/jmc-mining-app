var express = require('express'),
    app = express(),
    bodyParser = require('body-parser'),
    MongoClient = require('mongodb').MongoClient,
    engines = require('consolidate'),
    assert = require('assert'),
    ObjectId = require('mongodb').ObjectID,
    redis = require("redis"),
    msRestAzure = require('ms-rest-azure'),
    KeyVault = require('azure-keyvault'),
    appInsights = require('applicationinsights');

const KEYVAULT_URI = null || process.env['KEYVAULT_URI'],
    REDIS_HOST = null || process.env['REDIS_HOST'],
    COLLECTION_NAME = 'records',
    SECRET_MONGO_URL = 'MongoDB-URL',
    SECRET_REDIS = 'Redis-Key',
    APIM_KEY = null || process.env['APPINSIGHTS_INSTRUMENTATIONKEY'];

if(APIM_KEY) {
    appInsights.setup(APIM_KEY)
        .setAutoDependencyCorrelation(true)
        .setAutoCollectRequests(true)
        .setAutoCollectPerformance(true)
        .setAutoCollectExceptions(true)
        .setAutoCollectDependencies(true)
        .setAutoCollectConsole(true)
        .setUseDiskRetryCaching(true)
        .start();
}

var loginStr = 'Anonymous';

console.log(`KEYVALUT_URI=${KEYVAULT_URI}`);
console.log(`REDIS_HOST=${REDIS_HOST}`);

app.use(express.static(__dirname + "/public"));

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

app.engine('html', engines.nunjucks);
app.set('view engine', 'html');
app.set('views', __dirname + '/views');

assert(process.env.APPSETTING_WEBSITE_SITE_NAME);
console.log("Login for AppServiceMSI");

msRestAzure.loginWithAppServiceMSI({resource: 'https://vault.azure.net'}, function(err, token) {
    assert.equal(null, err);
    let client = new KeyVault.KeyVaultClient(token);
    let promiseMongo = client.getSecret(KEYVAULT_URI, SECRET_MONGO_URL, "");
    let promiseRedis = client.getSecret(KEYVAULT_URI, SECRET_REDIS, "");
    Promise.all([promiseMongo, promiseRedis]).then(values => {
        //console.log(values);
        let url = values[0].value;
        let redisKey = values[1].value;
        console.log(SECRET_MONGO_URL + "=" + url);
        console.log(SECRET_REDIS + "=" + redisKey);

        // create DB connection
        MongoClient.connect(url, function(err, db) {
            assert.equal(null, err);
            console.log('Successfully connected to MongoDB');

            var records_collection = db.collection(COLLECTION_NAME);
            console.log("DB collection ready for: " + COLLECTION_NAME);
            
            var cache = redis.createClient(6380, REDIS_HOST, 
                {auth_pass: redisKey, tls: {servername: REDIS_HOST}});
            console.log("Cache ready for: " + REDIS_HOST);

            app.get('/records', function(req, res, next) {
                console.log("Received get /records request");
                console.log(req.headers);
                var loginName = req.header('x-ms-client-principal-name');
                var idpName = req.header('x-ms-client-principal-idp');
                if((loginName !== undefined) && (loginName !== null))
                    loginStr = loginName + ' (' + idpName + ')';

                cache.HGETALL(COLLECTION_NAME, function(err, reply) {
                    if(err) throw err;
                    else if(reply) {
                        // cache returns a hashtable object (_id : stringified record object)
                        //var records = Object.values(reply);
                        // Object.values not yet supported on Azure app service, gives error
                        var records = Object.keys(reply).map((k) => reply[k]);
                        console.log("Cache hit, reply size: " + records.length);
                        // convert record string to object
                        for(var i = 0; i < records.length; i++) {
                            records[i] = JSON.parse(records[i]);
                        }
                        // append the login string to the record list
                        records.push({"loginStr": loginStr});
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

                            // write to cache as hashtable, key is _id, value is the record object
                            var i, hashList = [];
                            for(i = 0; i < records.length; i++) {
                                hashList[2 * i] = records[i]._id.toString();
                                hashList[2 * i + 1] = JSON.stringify(records[i]);
                            }
                            cache.HMSET(COLLECTION_NAME, hashList);
                            console.log("Cache set successfully");

                            // append the login string to the record list
                            records.push({"loginStr": loginStr});
                            res.json(records);
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
                    cache.HSET(COLLECTION_NAME, insertedId.toString(), JSON.stringify(insertedRecord));
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
                    cache.HDEL(COLLECTION_NAME, id.toString());
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
                        cache.HSET(COLLECTION_NAME, id.toString(), JSON.stringify(updatedRecord));
                });
            });

            app.use(errorHandler);
            var server = app.listen(process.env.PORT || 3000, function() {
                var port = server.address().port;
                console.log('Express server listening on port %s.', port);
            });
        });
    }, err => {
        console.log(err);
    });
});

function errorHandler(err, req, res, next) {
    console.error(err.message);
    console.error(err.stack);
    res.status(500).render("error_template", { error: err});
}

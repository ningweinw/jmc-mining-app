// new code added for feature-1

var express = require('express'),
    app = express(),
    bodyParser = require('body-parser'),
    MongoClient = require('mongodb').MongoClient,
    engines = require('consolidate'),
    assert = require('assert'),
    ObjectId = require('mongodb').ObjectId,
    redis = require("redis");

const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");

const KEYVAULT_URI = null || process.env['KEYVAULT_URI'],
    REDIS_HOST = null || process.env['REDIS_HOST'],
    DB_NAME = 'admin',
    COLLECTION_NAME = 'records',
    SECRET_MONGO_URL = 'MongoDB-URL',
    SECRET_REDIS = 'Redis-Key',
    APIM_KEY = null || process.env['APPINSIGHTS_INSTRUMENTATIONKEY'];

var loginStr = 'Anonymous';

console.log(`KEYVALUT_URI=${KEYVAULT_URI}`);
console.log(`REDIS_HOST=${REDIS_HOST}`);

app.use(express.static(__dirname + "/public"));

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

app.engine('html', engines.nunjucks);
app.set('view engine', 'html');
app.set('views', __dirname + '/views');

// Retrieve MongoDB URL and Redis key from Key Vault using system assigned MI
console.log("Connect to KeyVault with AppService's system assigned MI");
const credential = new DefaultAzureCredential();    // credential provider using system assigned MI
const client = new SecretClient(KEYVAULT_URI, credential);
let promiseMongo = client.getSecret(SECRET_MONGO_URL);
let promiseRedis = client.getSecret(SECRET_REDIS);
Promise.all([promiseMongo, promiseRedis]).then(values => {
    const mongoDbUrl = values[0].value;
    const redisKey = values[1].value;
    console.log(SECRET_MONGO_URL + "=" + mongoDbUrl);
    console.log(SECRET_REDIS + "=" + redisKey);

    // Connect to MongoDB
    const mongoClient = new MongoClient(mongoDbUrl);
    mongoClient.connect();
    console.log('Successfully connected to MongoDB');

    const db = mongoClient.db(DB_NAME);
    const records_collection = db.collection(COLLECTION_NAME);
    console.log("DB collection ready for: " + COLLECTION_NAME);

    // Connect to Redis
    const cache = redis.createClient(6380, REDIS_HOST, 
        {auth_pass: redisKey, tls: {servername: REDIS_HOST}});
    console.log("Cache ready for: " + REDIS_HOST);

    app.get('/records', function(req, res, next) {
        console.log("Received get /records request");
        console.log(req.headers);
        var loginName = req.header('x-ms-client-principal-name');
        var idpName = req.header('x-ms-client-principal-idp');
        if((loginName !== undefined) && (loginName !== null))
            loginStr = loginName + ' (' + idpName + ')';
        console.log('loginStr=', loginStr);

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
        records_collection.insertOne(req.body, function(err, result) {
            if(err) throw err;
            var insertedId = result.insertedId;
            console.log(`A document was inserted with the _id: ${insertedId}`);

            // return OK response, the response body is not used by client
            res.json({_id: insertedId});

            // update cache
            cache.HSET(COLLECTION_NAME, insertedId.toString(), JSON.stringify(req.body));
        });
    });

    app.delete('/records/:id', function(req, res, next){
        var id = req.params.id;
        console.log("Received delete request for: " + id);
        records_collection.deleteOne({'_id': new ObjectId(id)}, function(err, result){
            if(err) throw err;
            console.log(`A document was deleted with the _id: ${id}`);

            // return OK response, the response body is not used by client
            res.json({_id: id});

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
            }, function(err, result){
                if(err) throw err;
                console.log(`A document was updated with the _id: ${id}`);

                // return OK response, the response body is not used by client
                res.json({_id: id});

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

function errorHandler(err, req, res, next) {
    console.error(err.message);
    console.error(err.stack);
    res.status(500).render("error_template", { error: err});
}

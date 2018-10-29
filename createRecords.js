var MongoClient = require('mongodb').MongoClient,
    ObjectId = require('mongodb').ObjectID,
    assert = require('assert'),
    url = 'mongodb://c4tssg2:uVIMgFJOLZ7nFPTCqavJakAJRwVsBvOJINWqFzpIRcY6oEuCAaa5uykPVMt1eLxnSti6cOts44GbDXcX8s4gkg%3D%3D@c4tssg2.documents.azure.com:10255/?ssl=true',
    collectionName = 'records';

MongoClient.connect(url, async (err, db) => {
    assert.equal(null, err);
    console.log('Successfully connected to MongoDB');

    var records_collection = db.collection(collectionName);
    console.log("DB collection ready for: " + collectionName);
    
    // create 10k records
    var num = 10000;
    var rcd = {}, rv;
    for(var i = 1; i <= num; i++) {
        rcd._id = i;
        rcd.name = 'Person-' + i;
        rcd.email = rcd.name + '@corp.com';
        rcd.phone = (99999999 - i).toString();
        rv = await records_collection.insertOne(rcd);
        console.log('Created: ' + rcd.name);
    }
    process.exit();
});

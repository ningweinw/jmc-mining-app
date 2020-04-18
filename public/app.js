angular
    .module('app', [])
    .controller('appCtrl', AppCtrl);

AppCtrl.$inject = ['$scope', '$http'];

function AppCtrl($scope, $http) {
    var vm = this;
    vm.fields = [
        {label: 'Name', key: 'name'},
        {label: 'Email', key: 'email'},
        {label: 'Phone', key: 'phone'}
    ];
    vm.record = {};
    vm.records = [];
    vm.allRecords = [];
    vm.pager = {};
    vm.loginStr = '';

    vm.handleError = function(response) {
        console.log(response.status + " - " + response.statusText + " - " + response.data);
    }

    vm.setPage = function(page) {
        if (page < 1 || page > vm.pager.totalPages) {
            return;
        }
 
        // get pager object
        vm.pager = vm.getPager(vm.allRecords.length, page, 15);
        //console.log(vm.pager);
 
        // get current page of items
        vm.records = vm.allRecords.slice(vm.pager.startIndex, vm.pager.endIndex + 1);
    }

    vm.getAllRecords = function() {
        $http.get('/records').then(function(response){
            vm.allRecords = response.data;
            vm.loginStr = vm.allRecords.pop().loginStr;
            if(vm.loginStr == "Anonymous")
                document.getElementById("logout").style.display = "none";
            
            console.log("Records queried from DB: " + vm.allRecords.length);
            vm.setPage(1);
        }, function(response){
            vm.handleError(response);
        });
    }

    vm.getAllRecords();

    vm.editMode = false;
    vm.saveRecord = function() {
        if(vm.editMode) {
            vm.updateRecord();
        } else {
            vm.addRecord();
        }
    }

    vm.addRecord = function() {
        console.log(vm.record);
        $http.post('/records', vm.record).then(function(response){
            vm.record = {};
            vm.getAllRecords();
        }, function(response){
            vm.handleError(response);
        });
    }

    vm.updateRecord = function() {
        $http.put('/records/' + vm.record._id, vm.record).then(function(response){
            vm.record = {};
            vm.getAllRecords();
            vm.editMode = false;
        }, function(response){
            vm.handleError(response);
        });
    }

    vm.editRecord = function(record) {
        vm.record = record;
        vm.editMode = true;
    }

    vm.deleteRecord = function(recordid) {
        $http.delete('/records/'+recordid).then(function(response){
            console.log("Deleted");
            vm.getAllRecords();
        }, function(response){
            vm.handleError(response);
        })
    }

    vm.cancelEdit = function() {
        vm.editMode = false;
        vm.record = {};
        vm.getAllRecords();
    }

    vm.getPager = function(totalItems, currentPage, pageSize) {
        // default to first page
        currentPage = currentPage || 1;

        // default page size is 10
        pageSize = pageSize || 10;

        // calculate total pages
        var totalPages = Math.ceil(totalItems / pageSize);

        var startPage, endPage;
        if (totalPages <= 10) {
            // less than 10 total pages so show all
            startPage = 1;
            endPage = totalPages;
        } else {
            // more than 10 total pages so calculate start and end pages
            if (currentPage <= 6) {
                startPage = 1;
                endPage = 10;
            } else if (currentPage + 4 >= totalPages) {
                startPage = totalPages - 9;
                endPage = totalPages;
            } else {
                startPage = currentPage - 5;
                endPage = currentPage + 4;
            }
        }

        // calculate start and end item indexes
        var startIndex = (currentPage - 1) * pageSize;
        var endIndex = Math.min(startIndex + pageSize - 1, totalItems - 1);

        // create an array of pages to ng-repeat in the pager control
        var pages = [], c = endPage - startPage + 1;
        while(c--){
            pages[c] = endPage--;
        }

        // return object with all pager properties required by the view
        return {
            totalItems: totalItems,
            currentPage: currentPage,
            pageSize: pageSize,
            totalPages: totalPages,
            startPage: startPage,
            endPage: endPage,
            startIndex: startIndex,
            endIndex: endIndex,
            pages: pages
        };
    }
}

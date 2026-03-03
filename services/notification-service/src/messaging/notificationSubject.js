'use strict';

const { Subject } = require('rxjs');

const notificationSubject = new Subject();

module.exports = { notificationSubject };

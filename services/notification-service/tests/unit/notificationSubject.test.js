'use strict';

const { Subject } = require('rxjs');
const { notificationSubject } = require('../../src/messaging/notificationSubject');

describe('notificationSubject', () => {
  test('exports a Subject instance', () => {
    expect(notificationSubject).toBeInstanceOf(Subject);
  });

  test('emits values to subscribers', done => {
    const payload = { id: 1, eventType: 'book.created' };

    const sub = notificationSubject.subscribe(value => {
      expect(value).toEqual(payload);
      sub.unsubscribe();
      done();
    });

    notificationSubject.next(payload);
  });

  test('is a singleton — same reference on repeated require', () => {
    const { notificationSubject: second } = require('../../src/messaging/notificationSubject');
    expect(second).toBe(notificationSubject);
  });
});

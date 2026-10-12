// The page: the reader of books, which reads them in a worker of their own (reading.ts,
// parser-worker.ts), and the app (App.tsrx).
import { mount } from 'ripple';
import type { Component } from 'ripple';
import ParserWorker from './parser-worker.ts?worker&inline';
import { createReader } from './reading.ts';
import { App } from './App.tsrx';

// the worker is made from its script held in the page, so a page opened as a file has it too
const reader = createReader({
  makeWorker(answered, failed) {
    let worker = new ParserWorker();
    worker.onmessage = ({ data }) => answered(data);
    worker.onerror = () => failed();
    return worker;
  },
});

// mount takes any component, whatever props it needs: these are App's
mount(App as Component, { props: { reader }, target: document.body });

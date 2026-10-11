// The page: the parser and what a book is, run from their text (see load-parser.js), the
// reader of books that hands that text to a worker (reading.js), and the app (App.tsrx).
import { mount } from 'ripple';
import type { Component } from 'ripple';
import parserSource from './parser.js?raw';
import bookSource from './book.js?raw';
import { loadParser } from './load-parser.js';
import { createReader } from './reading.js';
import { App } from './App.tsrx';

const parser = loadParser(parserSource, bookSource, console);
const reader = createReader({ parserSource, parser });

// mount takes any component, whatever props it needs: these are App's
mount(App as Component, { props: { parser, reader }, target: document.body });

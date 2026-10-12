// The page: the app (App.tsrx), mounted on <body>.
import { mount } from 'ripple';
import type { Component } from 'ripple';
import { App } from './App.tsrx';

mount(App as Component, { props: {}, target: document.body });

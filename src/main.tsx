import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { Analytics } from './Analytics';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><BrowserRouter><Analytics /><App /></BrowserRouter></React.StrictMode>,
);

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { instalarCapturaDeErros } from './services/errosService';
import { instalarSemZeroNegativo } from './utils/zeroNegativo';

instalarCapturaDeErros();
instalarSemZeroNegativo();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
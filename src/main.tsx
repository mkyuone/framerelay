import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider, Modal, createTheme } from '@mantine/core';
import { BrowserRouter } from 'react-router-dom';
import '@mantine/core/styles.css';
import '@image-ultra/react/styles.css';
import '@fontsource-variable/inter';
import './styles.css';
import App from './App';
import { AppProvider } from './context';

if (location.pathname === '/_render') {
  void import('./render');
} else
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <MantineProvider
        forceColorScheme="dark"
        theme={createTheme({
          fontFamily: '"Inter Variable", sans-serif',
          primaryColor: 'blue',
          defaultRadius: 6,
          components: {
            Modal: Modal.extend({ defaultProps: { closeButtonProps: { 'aria-label': 'Close' } } }),
          },
        })}
      >
        <BrowserRouter>
          <AppProvider>
            <App />
          </AppProvider>
        </BrowserRouter>
      </MantineProvider>
    </React.StrictMode>,
  );

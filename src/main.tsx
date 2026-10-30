import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider, createTheme } from '@mantine/core';
import '@mantine/core/styles.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import './styles.css';
import App from './App';

const theme = createTheme({
    fontFamily: 'DM Sans, sans-serif',
    headings: { fontFamily: 'Space Grotesk, sans-serif' },
    primaryColor: 'green',
    defaultRadius: 4,
    colors: {
        green: ['#ecf6f0', '#d9eade', '#b3d5bf', '#8cbea1', '#68aa85', '#509e73', '#348259', '#296b49', '#20583c', '#17452f'],
    },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <MantineProvider theme={theme} forceColorScheme="light"><App /></MantineProvider>
    </React.StrictMode>,
);
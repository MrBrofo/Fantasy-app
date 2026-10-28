import { Config } from '@remotion/cli/config';

// use the installed Chrome instead of downloading one
Config.setBrowserExecutable('C:/Program Files/Google/Chrome/Application/chrome.exe');
Config.setEntryPoint('src/index.jsx');

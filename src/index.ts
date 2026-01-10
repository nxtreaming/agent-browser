#!/usr/bin/env node
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { send, setDebug, setSession, getSession } from './client.js';
import type { Response } from './types.js';

/**
 * List all active veb sessions
 */
function listSessions(): string[] {
  const tmpDir = os.tmpdir();
  try {
    const files = fs.readdirSync(tmpDir);
    const sessions: string[] = [];
    
    for (const file of files) {
      const match = file.match(/^veb-(.+)\.pid$/);
      if (match) {
        const pidFile = path.join(tmpDir, file);
        try {
          const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
          // Check if process is still running
          process.kill(pid, 0);
          sessions.push(match[1]);
        } catch {
          // Process not running, ignore
        }
      }
    }
    
    return sessions;
  } catch {
    return [];
  }
}

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

const c = (color: keyof typeof colors, text: string) => `${colors[color]}${text}${colors.reset}`;

function printHelp(): void {
  console.log(`
${c('bold', 'veb')} - headless browser automation for agents and humans

${c('yellow', 'Usage:')}
  veb <command> [options]

${c('yellow', 'Commands:')}
  ${c('cyan', 'open')} <url>                    Open a URL in the browser
  ${c('cyan', 'click')} <selector>              Click an element
  ${c('cyan', 'type')} <selector> <text>        Type text into an element
  ${c('cyan', 'press')} <key>                   Press a keyboard key
  ${c('cyan', 'wait')} <selector|text|ms>       Wait for element, text, or duration
  ${c('cyan', 'screenshot')} [path]             Take a screenshot
  ${c('cyan', 'snapshot')}                      Get accessibility tree (for agents)
  ${c('cyan', 'extract')} <selector>            Extract element content
  ${c('cyan', 'eval')} <script>                 Evaluate JavaScript
  ${c('cyan', 'scroll')} <direction> [amount]   Scroll the page
  ${c('cyan', 'hover')} <selector>              Hover over an element
  ${c('cyan', 'select')} <selector> <value>     Select dropdown option
  ${c('cyan', 'close')}                         Close browser and stop daemon

${c('yellow', 'Tab/Window Commands:')}
  ${c('cyan', 'tab new')}                       Open a new tab
  ${c('cyan', 'tab list')}                      List all open tabs
  ${c('cyan', 'tab')} <index>                   Switch to tab by index
  ${c('cyan', 'tab close')} [index]             Close tab (current if no index)
  ${c('cyan', 'window new')}                    Open a new window

${c('yellow', 'Session Commands:')}
  ${c('cyan', 'session')}                       Show current session name
  ${c('cyan', 'session list')}                  List all active sessions

${c('yellow', 'Options:')}
  --session <name>              Use isolated browser session (or VEB_SESSION env)
  --json                        Output raw JSON (for agents)
  --selector, -s <sel>          Target specific element
  --text, -t                    Wait for text instead of selector
  --full, -f                    Full page screenshot
  --debug                       Show debug output
  --help, -h                    Show help

${c('yellow', 'Examples:')}
  veb open https://example.com
  veb click "#submit-btn"
  veb type "#email" "hello@example.com"
  veb wait --text "Welcome"
  veb wait 2000
  veb screenshot --full page.png
  veb extract "table" --json
  veb eval "document.title"
  veb scroll down 500
  veb tab new
  veb tab list
  veb tab 0
`);
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function printResponse(response: Response, jsonMode: boolean): void {
  if (jsonMode) {
    console.log(JSON.stringify(response));
    return;
  }
  
  if (!response.success) {
    console.error(c('red', '✗ Error:'), response.error);
    process.exit(1);
  }
  
  const data = response.data as Record<string, unknown>;
  
  // Pretty print based on data type
  if (data.url && data.title) {
    console.log(c('green', '✓'), c('bold', data.title as string));
    console.log(c('dim', `  ${data.url}`));
  } else if (data.html) {
    console.log(data.html);
  } else if (data.snapshot) {
    console.log(data.snapshot);
  } else if (data.result !== undefined) {
    const result = data.result;
    if (typeof result === 'object') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result);
    }
  } else if (data.base64) {
    console.log(c('green', '✓'), 'Screenshot captured (base64)');
    console.log(c('dim', `  ${(data.base64 as string).length} bytes`));
  } else if (data.path) {
    console.log(c('green', '✓'), `Saved to ${data.path}`);
  } else if (data.clicked || data.typed || data.pressed || data.hovered || data.scrolled || data.selected || data.waited) {
    console.log(c('green', '✓'), 'Done');
  } else if (data.launched) {
    console.log(c('green', '✓'), 'Browser launched');
  } else if (data.closed === true) {
    console.log(c('green', '✓'), 'Browser closed');
  } else if (data.tabs) {
    // Tab list
    const tabs = data.tabs as Array<{ index: number; url: string; title: string; active: boolean }>;
    tabs.forEach(tab => {
      const marker = tab.active ? c('green', '→') : ' ';
      const idx = c('cyan', `[${tab.index}]`);
      const title = tab.title || c('dim', '(untitled)');
      console.log(`${marker} ${idx} ${title}`);
      if (tab.url) console.log(c('dim', `     ${tab.url}`));
    });
  } else if (data.index !== undefined && data.total !== undefined) {
    // Tab new / window new
    console.log(c('green', '✓'), `Tab ${data.index} created (${data.total} total)`);
  } else if (data.remaining !== undefined) {
    // Tab close
    console.log(c('green', '✓'), `Tab closed (${data.remaining} remaining)`);
  } else {
    console.log(c('green', '✓'), JSON.stringify(data));
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  // Enable debug mode early
  const debugMode = args.includes('--debug');
  if (debugMode) {
    setDebug(true);
  }
  
  // Handle session - check --session flag first, then env var
  const sessionIdx = args.findIndex(a => a === '--session');
  if (sessionIdx !== -1 && args[sessionIdx + 1]) {
    setSession(args[sessionIdx + 1]);
  }
  // VEB_SESSION env var is already handled by daemon.ts default
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }
  
  const jsonMode = args.includes('--json');
  const fullPage = args.includes('--full') || args.includes('-f');
  const textMode = args.includes('--text') || args.includes('-t');
  
  // Remove flag args and their values
  const cleanArgs = args.filter((a, i) => {
    if (a.startsWith('-')) return false;
    // Check if previous arg was a flag that takes a value
    const prev = args[i - 1];
    if (prev === '--selector' || prev === '-s') return false;
    if (prev === '--session') return false;
    return true;
  });
  const command = cleanArgs[0];
  
  // Find --selector value
  let selectorOverride: string | undefined;
  const sIdx = args.findIndex(a => a === '--selector' || a === '-s');
  if (sIdx !== -1 && args[sIdx + 1]) {
    selectorOverride = args[sIdx + 1];
  }
  
  const id = genId();
  let cmd: Record<string, unknown>;
  
  switch (command) {
    case 'open':
    case 'goto':
    case 'navigate': {
      const url = cleanArgs[1];
      if (!url) {
        console.error(c('red', 'Error:'), 'URL required');
        process.exit(1);
      }
      // Auto-add https if missing
      const fullUrl = url.startsWith('http') ? url : `https://${url}`;
      cmd = { id, action: 'navigate', url: fullUrl };
      break;
    }
    
    case 'click': {
      const selector = cleanArgs[1];
      if (!selector) {
        console.error(c('red', 'Error:'), 'Selector required');
        process.exit(1);
      }
      cmd = { id, action: 'click', selector };
      break;
    }
    
    case 'type': {
      const selector = cleanArgs[1];
      const text = cleanArgs.slice(2).join(' ');
      if (!selector || !text) {
        console.error(c('red', 'Error:'), 'Selector and text required');
        process.exit(1);
      }
      cmd = { id, action: 'type', selector, text, clear: true };
      break;
    }
    
    case 'press': {
      const key = cleanArgs[1];
      if (!key) {
        console.error(c('red', 'Error:'), 'Key required');
        process.exit(1);
      }
      cmd = { id, action: 'press', key, selector: selectorOverride };
      break;
    }
    
    case 'wait': {
      const target = cleanArgs[1];
      if (!target) {
        console.error(c('red', 'Error:'), 'Selector, text, or milliseconds required');
        process.exit(1);
      }
      
      // Check if it's a number (milliseconds)
      const ms = parseInt(target, 10);
      if (!isNaN(ms)) {
        cmd = { id, action: 'wait', timeout: ms };
      } else if (textMode) {
        // Wait for text - use evaluate to check for text
        cmd = { id, action: 'wait', selector: `text=${target}` };
      } else {
        cmd = { id, action: 'wait', selector: target };
      }
      break;
    }
    
    case 'screenshot':
    case 'ss': {
      const pathArg = cleanArgs[1];
      cmd = { 
        id, 
        action: 'screenshot', 
        path: pathArg,
        fullPage,
        selector: selectorOverride,
      };
      break;
    }
    
    case 'snapshot':
    case 'aria':
    case 'a11y': {
      cmd = { id, action: 'snapshot' };
      break;
    }
    
    case 'extract':
    case 'html':
    case 'content': {
      const selector = cleanArgs[1] || selectorOverride;
      cmd = { id, action: 'content', selector };
      break;
    }
    
    case 'eval':
    case 'js': {
      const script = cleanArgs.slice(1).join(' ');
      if (!script) {
        console.error(c('red', 'Error:'), 'Script required');
        process.exit(1);
      }
      cmd = { id, action: 'evaluate', script };
      break;
    }
    
    case 'scroll': {
      const dirOrAmount = cleanArgs[1];
      const amount = parseInt(cleanArgs[2], 10) || 300;
      
      if (['up', 'down', 'left', 'right'].includes(dirOrAmount)) {
        cmd = { id, action: 'scroll', direction: dirOrAmount, amount, selector: selectorOverride };
      } else {
        const y = parseInt(dirOrAmount, 10) || 300;
        cmd = { id, action: 'scroll', y, selector: selectorOverride };
      }
      break;
    }
    
    case 'hover': {
      const selector = cleanArgs[1];
      if (!selector) {
        console.error(c('red', 'Error:'), 'Selector required');
        process.exit(1);
      }
      cmd = { id, action: 'hover', selector };
      break;
    }
    
    case 'select': {
      const selector = cleanArgs[1];
      const value = cleanArgs[2];
      if (!selector || !value) {
        console.error(c('red', 'Error:'), 'Selector and value required');
        process.exit(1);
      }
      cmd = { id, action: 'select', selector, values: value };
      break;
    }
    
    case 'close':
    case 'quit':
    case 'exit': {
      cmd = { id, action: 'close' };
      break;
    }
    
    case 'tab': {
      const subCmd = cleanArgs[1];
      
      if (subCmd === 'new') {
        cmd = { id, action: 'tab_new' };
      } else if (subCmd === 'list' || subCmd === 'ls') {
        cmd = { id, action: 'tab_list' };
      } else if (subCmd === 'close') {
        const tabIndex = cleanArgs[2] !== undefined ? parseInt(cleanArgs[2], 10) : undefined;
        cmd = { id, action: 'tab_close', index: tabIndex };
      } else if (subCmd !== undefined) {
        // Assume it's a tab index to switch to
        const tabIndex = parseInt(subCmd, 10);
        if (isNaN(tabIndex)) {
          console.error(c('red', 'Error:'), `Invalid tab command or index: ${subCmd}`);
          process.exit(1);
        }
        cmd = { id, action: 'tab_switch', index: tabIndex };
      } else {
        // No subcommand - list tabs
        cmd = { id, action: 'tab_list' };
      }
      break;
    }
    
    case 'window': {
      const subCmd = cleanArgs[1];
      
      if (subCmd === 'new') {
        cmd = { id, action: 'window_new' };
      } else {
        console.error(c('red', 'Error:'), 'Usage: veb window new');
        process.exit(1);
      }
      break;
    }
    
    case 'session': {
      const subCmd = cleanArgs[1];
      
      if (subCmd === 'list' || subCmd === 'ls') {
        const sessions = listSessions();
        const currentSession = getSession();
        
        if (sessions.length === 0) {
          console.log(c('dim', 'No active sessions'));
        } else {
          sessions.forEach(sess => {
            const marker = sess === currentSession ? c('green', '→') : ' ';
            console.log(`${marker} ${c('cyan', sess)}`);
          });
        }
        process.exit(0);
      } else {
        // Show current session
        console.log(c('cyan', getSession()));
        process.exit(0);
      }
    }
    
    default:
      console.error(c('red', 'Error:'), `Unknown command: ${command}`);
      console.error(c('dim', 'Run veb --help for usage'));
      process.exit(1);
  }
  
  try {
    const response = await send(cmd);
    printResponse(response, jsonMode);
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (jsonMode) {
      console.log(JSON.stringify({ id, success: false, error: message }));
    } else {
      console.error(c('red', '✗ Error:'), message);
    }
    process.exit(1);
  }
}

main();

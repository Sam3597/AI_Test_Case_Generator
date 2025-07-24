import React, { useState, useEffect } from 'react';
import './App.css';

function parseTestCases(raw) {
  const lines = raw.split('\n').filter(line => line.trim() && line.includes('|'));
  const data = lines.map(line =>
    line
      .split('|')
      .map(cell => cell.trim())
      .filter(Boolean)
  );
  if (data.length > 1 && data[0][0].toLowerCase().includes('test case id')) {
    data.shift();
  }
  return data;
}

const HISTORY_KEY = 'ai-tcgen-history-v1';
const THEME_KEY = 'ai-tcgen-theme';

function arrayToCSV(arr) {
  return [
    ['Test Case ID', 'Test Scenario', 'Test Steps', 'Expected Result'],
    ...arr
  ].map(row => row.map(cell => '"' + (cell || '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
}

function arrayToMarkdownTable(arr) {
  const header = ['Test Case ID', 'Test Scenario', 'Test Steps', 'Expected Result'];
  const rows = [header, ...arr];
  const sep = header.map(() => '---');
  return [header, sep, ...arr].map(row => '| ' + row.map(cell => cell || '').join(' | ') + ' |').join('\n');
}

function downloadCSV(data, filename = 'test-cases.csv') {
  const blob = new Blob([data], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

function App() {
  const [prompt, setPrompt] = useState('');
  const [sheetId, setSheetId] = useState('');
  const [credentialsJson, setCredentialsJson] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState([]);
  const [canWrite, setCanWrite] = useState(false);
  const [writeLoading, setWriteLoading] = useState(false);
  const [writeSuccess, setWriteSuccess] = useState(false);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [jsonError, setJsonError] = useState('');
  const [copied, setCopied] = useState(false);
  const [showSheetFields, setShowSheetFields] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(HISTORY_KEY);
    if (stored) {
      setHistory(JSON.parse(stored));
    }
    const theme = localStorage.getItem(THEME_KEY);
    if (theme === 'dark') {
      setDarkMode(true);
      document.body.classList.add('dark-mode');
    }
  }, []);

  useEffect(() => {
    if (darkMode) {
      document.body.classList.add('dark-mode');
      localStorage.setItem(THEME_KEY, 'dark');
    } else {
      document.body.classList.remove('dark-mode');
      localStorage.setItem(THEME_KEY, 'light');
    }
  }, [darkMode]);

  const saveToHistory = (prompt, preview) => {
    const entry = { prompt, preview, timestamp: Date.now() };
    const newHistory = [entry, ...history].slice(0, 20); // keep last 20
    setHistory(newHistory);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
  };

  const handleFileChange = (e) => {
    setJsonError('');
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          JSON.parse(evt.target.result);
          setCredentialsJson(evt.target.result);
        } catch (err) {
          setCredentialsJson('');
          setJsonError('Invalid JSON file. Please upload a valid Google service account JSON.');
        }
      };
      reader.readAsText(file);
    }
  };

  // Step 1: Generate preview only
  const handlePreview = async (e) => {
    e.preventDefault();
    setLoading(true);
    setResult('');
    setError('');
    setPreview([]);
    setCanWrite(false);
    setWriteSuccess(false);
    if (!prompt.trim()) {
      setError('Please enter a prompt.');
      setLoading(false);
      return;
    }
    try {
      // Call backend but do NOT write to sheet, just get preview
      const response = await fetch('https://www.testometer.in/api/generate-test-cases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt, sheet_id: '', credentials_json: '' }),
      });
      if (!response.ok) {
        const data = await response.json();
        let msg = data.detail || 'Unknown error';
        throw new Error(msg);
      }
      const data = await response.json();
      const parsed = Array.isArray(data.test_cases) ? data.test_cases : parseTestCases(data.test_cases);
      setPreview(parsed);
      setCanWrite(true);
      saveToHistory(prompt, parsed);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Show sheet fields and require them for writing
  const handleShowSheetFields = () => {
    setShowSheetFields(true);
    setWriteSuccess(false);
    setError('');
  };

  // Step 3: Confirm & Write to Sheet
  const handleWrite = async () => {
    setWriteLoading(true);
    setError('');
    setWriteSuccess(false);
    if (!sheetId.trim() || !credentialsJson.trim()) {
      setError('Please provide both Google Sheet ID and Service Account JSON.');
      setWriteLoading(false);
      return;
    }
    try {
      const response = await fetch('https://www.testometer.in/api/generate-test-cases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt, sheet_id: sheetId, credentials_json: credentialsJson }),
      });
      if (!response.ok) {
        const data = await response.json();
        let msg = data.detail || 'Unknown error';
        if (msg.includes('PERMISSION_DENIED')) msg = 'Google API error: Permission denied. Check your service account and sheet sharing.';
        if (msg.includes('invalid_grant')) msg = 'Google API error: Invalid credentials. Please check your service account JSON.';
        if (msg.includes('not found')) msg = 'Google Sheet not found. Please check your Sheet ID.';
        throw new Error(msg);
      }
      setWriteSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setWriteLoading(false);
    }
  };

  const handleHistoryLoad = (entry) => {
    setPrompt(entry.prompt);
    setPreview(entry.preview);
    setCanWrite(true);
    setWriteSuccess(false);
    setError('');
  };

  const handleDownloadCSV = () => {
    if (preview.length > 0) {
      const csv = arrayToCSV(preview);
      downloadCSV(csv);
    }
  };

  const handleCopy = () => {
    if (preview.length > 0) {
      const md = arrayToMarkdownTable(preview);
      navigator.clipboard.writeText(md).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    }
  };

  return (
    <div className="App">
      <div className="stacked-layout">
        <div className="card">
          <h1 style={{textAlign: 'center'}}>
            AI Test Case Generator
          </h1>
          <button className="history-btn" onClick={() => setShowHistory(h => !h)}>
            {showHistory ? 'Hide' : 'Show'} History
          </button>
          {showHistory && (
            <div style={{marginBottom: 18, background: '#f7faff', borderRadius: 10, boxShadow: '0 2px 8px rgba(44,62,80,0.07)', padding: 12, maxHeight: 220, overflowY: 'auto', width: '100%'}}>
              <div style={{fontWeight: 600, color: '#2563eb', marginBottom: 6}}>Prompt History</div>
              {history.length === 0 && <div style={{color: '#888'}}>No history yet.</div>}
              {history.map((entry, idx) => (
                <div key={entry.timestamp} style={{marginBottom: 10, borderBottom: '1px solid #eee', paddingBottom: 6}}>
                  <div style={{fontSize: 13, color: '#333', marginBottom: 2}}>{entry.prompt.slice(0, 80)}{entry.prompt.length > 80 ? '...' : ''}</div>
                  <button style={{fontSize: 12, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, padding: '3px 12px', fontWeight: 600, cursor: 'pointer'}} onClick={() => handleHistoryLoad(entry)}>Load</button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={handlePreview} style={{ marginBottom: 10, width: '100%' }}>
            <label>
              Prompt:
              <span className="info-tooltip">
                <span className="info" tabIndex={0}>ℹ️</span>
                <span className="tooltip-text">Describe what test cases you want.<br />For best results, ask for a table with columns:<br /><b>Test Case ID, Test Scenario, Test Steps, Expected Result</b>.</span>
              </span>
            </label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Enter your prompt (e.g., Write test cases for a login page in table format)"
              rows={4}
              style={{marginBottom: 10}}
              required
            />
            <button type="submit" disabled={loading}>
              {loading ? (<><span className="spinner" /> Generating...</>) : 'Generate'}
            </button>
          </form>
          {error && (
            <div className="status-error">
              <strong>Error:</strong> {error}
            </div>
          )}
        </div>
        <div className="preview-area">
          {preview.length > 0 && (
            <>
              <div className="preview-actions">
                <button onClick={handleDownloadCSV}>
                  Download as CSV
                </button>
                <button onClick={handleCopy}>
                  {copied ? 'Copied!' : 'Copy to Clipboard'}
                </button>
                <button className="write-btn" onClick={handleShowSheetFields}>
                  Write to Google Sheet
                </button>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Test Case ID</th>
                      <th>Test Scenario</th>
                      <th>Test Steps</th>
                      <th>Expected Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, idx) => (
                      <tr key={idx}>
                        <td>{row[0] || ''}</td>
                        <td>{row[1] || ''}</td>
                        <td>{row[2] || ''}</td>
                        <td>{row[3] || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {showSheetFields && (
                <div className="modal-overlay" onClick={() => setShowSheetFields(false)}>
                  <div className="modal" onClick={e => e.stopPropagation()}>
                    <button className="modal-close" onClick={() => setShowSheetFields(false)}>&times;</button>
                    <label>
                      Google Sheet ID:
                      <span className="info-tooltip">
                        <span className="info" tabIndex={0}>ℹ️</span>
                        <span className="tooltip-text">Paste the ID from your Google Sheet URL.<br />Example: docs.google.com/spreadsheets/d/<b>THIS_ID</b>/edit</span>
                      </span>
                    </label>
                    <input
                      type="text"
                      value={sheetId}
                      onChange={e => setSheetId(e.target.value)}
                      placeholder="Paste your Google Sheet ID here"
                    />
                    <label>
                      Google Service Account JSON:
                      <span className="info-tooltip">
                        <span className="info" tabIndex={0}>ℹ️</span>
                        <span className="tooltip-text">Upload your Google service account JSON file.<br />This is required to write to your Google Sheet.</span>
                      </span>
                    </label>
                    <input
                      type="file"
                      accept="application/json"
                      onChange={handleFileChange}
                    />
                    {jsonError && <div className="status-error" style={{marginBottom: 10}}>{jsonError}</div>}
                    <button className="write-btn" onClick={handleWrite} disabled={writeLoading} style={{marginTop: 10, minWidth: 180}}>
                      {writeLoading ? <span className="spinner" /> : 'Confirm & Write to Sheet'}
                    </button>
                  </div>
                </div>
              )}
              {writeSuccess && <div className="status-success" style={{marginTop: 16}}>✅ Test cases written to Google Sheet!</div>}
            </>
          )}
        </div>
      </div>
      <div className="footer">
        &copy; {new Date().getFullYear()} AI Test Case Generator &mdash; Powered by Gemini & Google Sheets
      </div>
    </div>
  );
}

export default App;

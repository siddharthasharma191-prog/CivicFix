'use strict';
(() => {
  const searchInput = document.querySelector('#report-search');
  const statusFilter = document.querySelector('#status-filter');
  const categoryFilter = document.querySelector('#category-filter');
  const reportBody = document.querySelector('#report-rows');
  let rows = [...document.querySelectorAll('#report-rows tr')];
  const emptyState = document.querySelector('#empty-state');
  const resultCount = document.querySelector('#result-count');
  const toast = document.querySelector('#toast');
  const reportForm = document.querySelector('#report-form');
  const formMessage = document.querySelector('#report-form-message');
  const submitButton = document.querySelector('#submit-report');
  const duplicateCandidates = document.querySelector('#duplicate-candidates');
  const adminLoginForm = document.querySelector('#admin-login-form');
  const adminLoginButton = document.querySelector('#admin-login-button');
  const adminLoginMessage = document.querySelector('#admin-login-message');
  const adminWorkspace = document.querySelector('#admin-workspace');
  const adminRows = document.querySelector('#admin-report-rows');
  const adminReportMessage = document.querySelector('#admin-report-message');
  const adminLogoutButton = document.querySelector('#admin-logout-button');
  const analyticsState = document.querySelector('#analytics-state');
  const analyticsContent = document.querySelector('#analytics-content');

  function filterReports() {
    const query = searchInput.value.trim().toLocaleLowerCase();
    const status = statusFilter.value;
    const category = categoryFilter.value;
    let visible = 0;
    for (const row of rows) {
      const text = `${row.dataset.search || ''} ${row.textContent}`.toLocaleLowerCase();
      const matches = (!query || text.includes(query)) && (status === 'all' || row.dataset.status === status) && (category === 'all' || row.dataset.category === category);
      row.hidden = !matches;
      if (matches) visible++;
    }
    emptyState.hidden = visible !== 0;
    resultCount.textContent = `Showing ${visible} of ${rows.length} reports`; 
  }

  function showToast(message) { toast.textContent = message; toast.hidden = false; }
  function addTextCell(row, value, className) {
    const cell = document.createElement('td');
    if (className) cell.className = className;
    cell.textContent = value;
    row.appendChild(cell);
    return cell;
  }
  function createReportRow(report) {
    const row = document.createElement('tr');
    row.dataset.status = report.status;
    row.dataset.category = report.category;
    row.dataset.search = `${report.title} ${report.reference} ${report.location} ${report.category}`.toLocaleLowerCase();

    const issueCell = document.createElement('td');
    const wrapper = document.createElement('div'); wrapper.className = 'issue-cell';
    const symbol = document.createElement('span'); symbol.className = `issue-symbol ${report.category === 'Roads & potholes' ? 'road-symbol' : report.category === 'Waste management' ? 'waste-symbol' : report.category === 'Streetlights' ? 'light-symbol' : report.category === 'Drainage' ? 'drain-symbol' : 'other-symbol'}`;
    symbol.setAttribute('aria-hidden', 'true'); symbol.textContent = report.category === 'Roads & potholes' ? '⌁' : report.category === 'Waste management' ? '♧' : report.category === 'Streetlights' ? '☼' : report.category === 'Drainage' ? '≋' : '⌂';
    const details = document.createElement('span'); const title = document.createElement('strong'); title.textContent = report.title;
    if (report.isDemo === true) { const demo = document.createElement('span'); demo.className = 'admin-demo-label'; demo.textContent = 'DEMO'; demo.setAttribute('aria-label', 'Fictional demonstration record'); title.appendChild(demo); row.dataset.demo = 'true'; } else { row.dataset.demo = 'false'; }
    const location = document.createElement('small'); location.textContent = report.location;
    details.append(title, location); wrapper.append(symbol, details); issueCell.appendChild(wrapper); row.appendChild(issueCell);

    const referenceCell = addTextCell(row, report.reference); const code = document.createElement('code'); code.textContent = report.reference; referenceCell.textContent = ''; referenceCell.appendChild(code);
    addTextCell(row, report.category);
    const priorityCell = document.createElement('td'); const priority = document.createElement('span'); priority.className = `priority-chip p-${String(report.priority).toLowerCase()}`; priority.textContent = report.priority; priorityCell.appendChild(priority); if (report.priorityReason) { const reason = document.createElement('small'); reason.className = 'priority-reason'; reason.textContent = report.priorityReason; priorityCell.appendChild(reason); } row.appendChild(priorityCell);
    const statusCell = document.createElement('td'); const status = document.createElement('span');
    const statusLabel = { 'in-progress': 'In progress', 'under-review': 'Under review', submitted: 'Submitted', resolved: 'Resolved' }[report.status] || 'Submitted';
    status.className = `status-chip ${{ 'in-progress': 'status-progress', 'under-review': 'status-review', submitted: 'status-submitted', resolved: 'status-resolved' }[report.status] || 'status-submitted'}`;
    const dot = document.createElement('i'); dot.setAttribute('aria-hidden', 'true'); status.append(dot, document.createTextNode(statusLabel)); statusCell.appendChild(status); row.appendChild(statusCell);
    const date = report.createdAt ? new Date(report.createdAt) : new Date();
    addTextCell(row, Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
    return row;
  }

  const nextStatus = { submitted: 'under-review', 'under-review': 'in-progress', 'in-progress': 'resolved', resolved: null };
  const statusLabels = { submitted: 'Submitted', 'under-review': 'Under review', 'in-progress': 'In progress', resolved: 'Resolved' };

  function setAdminSignedIn(signedIn) {
    if (adminLoginForm) adminLoginForm.hidden = signedIn;
    if (adminWorkspace) adminWorkspace.hidden = !signedIn;
  }

  async function loadAdminReports() {
    if (!adminRows || !adminReportMessage) return;
    adminReportMessage.textContent = '';
    try {
      const response = await window.fetch('/api/admin/reports', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      const payload = await response.json();
      if (response.status === 401) { setAdminSignedIn(false); return; }
      if (!response.ok) throw new Error(payload.error || 'Could not load administrative reports.');
      const fragment = document.createDocumentFragment();
      for (const report of payload.reports) {
        const row = document.createElement('tr');
        const titleCell = document.createElement('td');
        const title = document.createElement('strong'); title.textContent = report.title;
        if (report.isDemo === true) { const demo = document.createElement('span'); demo.className = 'admin-demo-label'; demo.textContent = 'DEMO'; demo.setAttribute('aria-label', 'Fictional demonstration record'); title.appendChild(demo); }
        const location = document.createElement('small'); location.textContent = report.location; location.style.display = 'block';
        titleCell.append(title, location); row.appendChild(titleCell);
        addTextCell(row, report.reference);
        addTextCell(row, statusLabels[report.status] || report.status);
        const priorityCell = document.createElement('td'); const priority = document.createElement('span'); priority.className = `priority-chip p-${String(report.priority).toLowerCase()}`; priority.textContent = report.priority; priorityCell.appendChild(priority); const reason = document.createElement('small'); reason.className = 'priority-reason'; reason.textContent = report.priorityReason || ''; priorityCell.appendChild(reason); row.appendChild(priorityCell);
        const actionCell = document.createElement('td'); actionCell.className = 'admin-action-cell';
        const targetStatus = nextStatus[report.status];
        if (targetStatus) {
          const select = document.createElement('select'); select.setAttribute('aria-label', `Next status for ${report.reference}`);
          const option = document.createElement('option'); option.value = targetStatus; option.textContent = statusLabels[targetStatus]; select.appendChild(option);
          const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Update status';
          button.addEventListener('click', async () => {
            button.disabled = true; adminReportMessage.textContent = '';
            try {
              const update = await window.fetch(`/api/admin/reports/${encodeURIComponent(report.id)}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ status: select.value }) });
              const result = await update.json();
              if (!update.ok) throw new Error(result.details || result.error || 'Status update failed.');
              adminReportMessage.textContent = `${result.report.reference} updated to ${statusLabels[result.report.status] || result.report.status}.`;
              await loadReports(); await loadAnalytics(); await loadAdminReports();
            } catch (error) { adminReportMessage.textContent = error.message || 'Status update failed.'; }
            finally { button.disabled = false; }
          });
          actionCell.append(select, button);
        } else {
          const finalLabel = document.createElement('span'); finalLabel.className = 'admin-final-status'; finalLabel.textContent = 'No further transition'; actionCell.appendChild(finalLabel);
        }
        row.appendChild(actionCell); fragment.appendChild(row);
      }
      adminRows.replaceChildren(fragment);
    } catch (error) { adminReportMessage.textContent = error.message || 'Could not load administrative reports.'; }
  }

  async function checkAdminSession() {
    if (!adminLoginForm) return;
    try {
      const response = await window.fetch('/api/admin/session', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      const payload = await response.json();
      if (payload.authenticated) { setAdminSignedIn(true); await loadAdminReports(); }
      else if (!payload.configured && adminLoginMessage) adminLoginMessage.textContent = 'Administrator access is not configured on the server.';
    } catch (_error) {
      if (adminLoginMessage) adminLoginMessage.textContent = 'The server could not be reached to check administrator access.';
    }
  }

  if (adminLoginForm) adminLoginForm.addEventListener('submit', async event => {
    event.preventDefault();
    adminLoginMessage.textContent = '';
    adminLoginButton.disabled = true;
    try {
      const password = document.querySelector('#admin-password').value;
      const response = await window.fetch('/api/admin/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ password }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Sign-in failed.');
      adminLoginForm.reset(); setAdminSignedIn(true); adminLoginMessage.textContent = '';
      await loadAdminReports();
    } catch (error) { adminLoginMessage.textContent = error.message || 'Sign-in failed.'; }
    finally { adminLoginButton.disabled = false; }
  });

  if (adminLogoutButton) adminLogoutButton.addEventListener('click', async () => {
    adminLogoutButton.disabled = true;
    try {
      const response = await window.fetch('/api/admin/session', { method: 'DELETE', headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Sign-out failed.');
      setAdminSignedIn(false); if (adminRows) adminRows.replaceChildren();
      if (adminLoginMessage) adminLoginMessage.textContent = 'You have signed out.';
    } catch (error) { if (adminReportMessage) adminReportMessage.textContent = error.message || 'Sign-out failed.'; }
    finally { adminLogoutButton.disabled = false; }
  });

  function renderDistribution(targetId, items) {
    const target = document.querySelector(targetId);
    if (!target) return;
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const li = document.createElement('li');
      const label = document.createElement('span'); label.textContent = item.label;
      const count = document.createElement('strong'); count.textContent = String(item.count); count.setAttribute('aria-label', `${item.count} reports`);
      li.append(label, count); fragment.appendChild(li);
    }
    target.replaceChildren(fragment);
  }

  async function loadAnalytics() {
    if (!analyticsState || !analyticsContent || typeof window.fetch !== 'function') return;
    analyticsState.textContent = 'Loading stored report analytics…';
    analyticsState.hidden = false; analyticsContent.hidden = true;
    try {
      const response = await window.fetch('/api/analytics', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) throw new Error('Analytics could not be loaded. Try refreshing.');
      const payload = await response.json();
      if (payload.source !== 'stored-reports' || !Number.isSafeInteger(payload.total) || payload.total < 0 || !Array.isArray(payload.statuses) || !Array.isArray(payload.categories) || !Array.isArray(payload.priorities)) throw new Error('The analytics response was invalid. Try refreshing.');
      for (const group of [payload.statuses, payload.categories, payload.priorities]) {
        if (!group.every(item => item && typeof item.label === 'string' && Number.isSafeInteger(item.count) && item.count >= 0)) throw new Error('The analytics response was invalid. Try refreshing.');
      }
      const total = document.querySelector('#analytics-total');
      if (total) total.textContent = String(payload.total);
      renderDistribution('#analytics-statuses', payload.statuses);
      renderDistribution('#analytics-categories', payload.categories);
      renderDistribution('#analytics-priorities', payload.priorities);
      const updated = document.querySelector('#analytics-updated');
      if (updated) {
        const date = new Date(payload.generatedAt);
        updated.textContent = Number.isNaN(date.getTime()) ? 'Counts reflect the last successful analytics load.' : `Calculated from stored reports at ${date.toLocaleString()}.`;
      }
      analyticsState.textContent = payload.total === 0 ? 'No reports are currently stored. Counts above show zero for each known group.' : 'Analytics loaded from stored report records.';
      analyticsContent.hidden = false;
    } catch (error) {
      analyticsState.textContent = error.message || 'Analytics could not be loaded. Try refreshing.';
      analyticsContent.hidden = true;
    }
  }

  async function loadReports() {
    if (typeof window.fetch !== 'function') return;
    try {
      const response = await window.fetch('/api/reports', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Could not load reports');
      const payload = await response.json();
      if (!Array.isArray(payload.reports)) throw new Error('Unexpected report response');
      const fragment = document.createDocumentFragment();
      payload.reports.forEach(report => fragment.appendChild(createReportRow(report)));
      reportBody.replaceChildren(fragment);
      rows = [...reportBody.querySelectorAll('tr')];
      const total = String(rows.length);
      const navCount = document.querySelector('#nav-report-count'); if (navCount) navCount.textContent = total;
      const badge = document.querySelector('#report-count-badge'); if (badge) badge.textContent = `${total} stored reports`;
      filterReports();
    } catch (_error) {
      showToast('Stored reports could not be loaded. The built-in fictional sample rows remain visible.');
    }
  }

  for (const row of rows) {
    row.dataset.demo = 'true';
    if (typeof row.querySelector === 'function') {
      const title = row.querySelector('.issue-cell strong');
      if (title && !title.querySelector('.admin-demo-label')) {
        const demo = document.createElement('span'); demo.className = 'admin-demo-label'; demo.textContent = 'DEMO';
        demo.setAttribute('aria-label', 'Fictional demonstration record'); title.appendChild(demo);
      }
    }
  }

  searchInput.addEventListener('input', filterReports);
  statusFilter.addEventListener('change', filterReports);
  categoryFilter.addEventListener('change', filterReports);
  document.querySelector('#clear-filters').addEventListener('click', () => { searchInput.value = ''; statusFilter.value = 'all'; categoryFilter.value = 'all'; filterReports(); searchInput.focus(); });
  document.querySelector('.banner-dismiss').addEventListener('click', () => document.querySelector('.prototype-banner').hidden = true);
  document.querySelector('#help-button').addEventListener('click', () => showToast('CivicFix is an educational local prototype. Dashboard sample reports are fictional; new reports are stored only in its local SQLite database.'));
  const refreshAnalyticsButton = document.querySelector('#refresh-analytics');
  if (refreshAnalyticsButton) refreshAnalyticsButton.addEventListener('click', loadAnalytics);
  document.querySelector('#export-hint').addEventListener('click', () => { document.querySelector('#issue-tracker').scrollIntoView({ behavior: 'smooth', block: 'start' }); searchInput.focus({ preventScroll: true }); });
  document.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach(item => { item.classList.remove('active'); item.removeAttribute('aria-current'); });
    link.classList.add('active'); link.setAttribute('aria-current', 'page');
  }));

  if (reportForm) reportForm.addEventListener('submit', async event => {
    event.preventDefault();
    formMessage.textContent = '';
    const report = {
      title: document.querySelector('#report-title').value,
      category: document.querySelector('#report-category').value,
      location: document.querySelector('#report-location').value,
      description: document.querySelector('#report-description').value,
      impact: document.querySelector('#report-impact').value
    };
    if (duplicateCandidates) { duplicateCandidates.replaceChildren(); duplicateCandidates.hidden = true; }
    submitButton.disabled = true;
    try {
      const response = await window.fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(report) });
      const payload = await response.json();
      if (!response.ok) {
        const details = payload.details && Object.values(payload.details).join(' ');
        throw new Error(details || payload.error || 'The report could not be submitted.');
      }
      reportForm.reset();
      formMessage.textContent = `Report saved. Reference: ${payload.report.reference}. Priority: ${payload.report.priority} — ${payload.report.priorityReason} It is stored locally for this prototype only.`;
      if (duplicateCandidates && Array.isArray(payload.duplicateCandidates) && payload.duplicateCandidates.length) {
        const heading = document.createElement('strong'); heading.textContent = 'Possible similar reports — review suggestions only';
        const list = document.createElement('ul');
        for (const candidate of payload.duplicateCandidates) { const item = document.createElement('li'); item.textContent = `${candidate.reference}: ${candidate.title} (${candidate.location}) — ${candidate.reason}. This report was still saved.`; list.appendChild(item); }
        duplicateCandidates.append(heading, list); duplicateCandidates.hidden = false;
      }
      showToast(`Demonstration report saved: ${payload.report.reference}`);
      await loadReports();
      await loadAnalytics();
      document.querySelector('#issue-tracker').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      formMessage.textContent = error.message === 'Failed to fetch' ? 'The server could not be reached. Please try again when it is running.' : error.message;
    } finally { submitButton.disabled = false; }
  });

  filterReports();
  if (typeof window.CivicFixTestHooks === 'object') window.CivicFixTestHooks.filterReports = filterReports;
  loadReports();
  loadAnalytics();
  checkAdminSession();
})();

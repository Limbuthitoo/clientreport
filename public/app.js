// ============ STATE ============
let currentUser = null;
let currentCampaignId = null;
let clients = [];
let campaigns = [];
let chartInstances = {};

// ============ AUTH ============
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) { window.location.href = '/login.html'; return; }
    const data = await res.json();
    currentUser = data.user;
    document.getElementById('userName').textContent = currentUser.full_name;
    document.getElementById('userRole').textContent = currentUser.role === 'superadmin' ? 'Admin' : 'Employee';
    document.getElementById('userAvatar').textContent = currentUser.full_name.charAt(0).toUpperCase();
    if (currentUser.role === 'superadmin') {
      document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
    }
  } catch { window.location.href = '/login.html'; }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

// ============ NAV ============
function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');
  const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navItem) navItem.classList.add('active');
  const titles = { dashboard:'Dashboard', clients:'Clients', campaigns:'Campaigns', 'new-campaign':'New Report', reports:'Reports', 'report-view':'Report', users:'Team', activity:'Activity Log' };
  document.getElementById('pageTitle').textContent = titles[page] || 'MetaPulse';
  if (page === 'dashboard') loadDashboard();
  if (page === 'clients') loadClients();
  if (page === 'campaigns') loadCampaigns();
  if (page === 'new-campaign') loadNewCampaignPage();
  if (page === 'reports') loadReportsPage();
  if (page === 'users') loadUsers();
  if (page === 'activity') loadActivity();
  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => { e.preventDefault(); navigateTo(item.dataset.page); });
});
document.getElementById('menuToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

// ============ API ============
async function api(url, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(`/api${url}`, opts);
    if (res.status === 401) { window.location.href = '/login.html'; return null; }
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Something went wrong', 'error'); return null; }
    return data;
  } catch (err) {
    showToast('Network error. Please try again.', 'error');
    return null;
  }
}

// ============ HELPERS ============
function showToast(msg, type = 'success') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icon = type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle';
  const safeMsg = esc(msg);
  t.innerHTML = `<i class="fa-solid ${icon}" style="color:${type==='success'?'var(--success)':type==='error'?'var(--danger)':'var(--info)'}"></i><span>${safeMsg}</span>`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function fmt(n) { if (n >= 1000000) return (n/1000000).toFixed(1)+'M'; if (n >= 1000) return (n/1000).toFixed(1)+'K'; return (n||0).toLocaleString(); }
function fmtCur(n) { return '$'+(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function statusBadge(s) {
  const cls = s==='completed'?'badge-completed':s==='pre-boost'?'badge-pre-boost':'badge-draft';
  const label = s==='pre-boost'?'Pre-Boost':s?s.charAt(0).toUpperCase()+s.slice(1):'Draft';
  return `<span class="badge ${cls}">${label}</span>`;
}
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

// ============ DASHBOARD ============
async function loadDashboard() {
  const d = await api('/dashboard');
  if (!d) return;
  document.getElementById('statClients').textContent = fmt(d.totalClients);
  document.getElementById('statCampaigns').textContent = fmt(d.totalCampaigns);
  document.getElementById('statCompleted').textContent = fmt(d.completedCampaigns);
  document.getElementById('statSpent').textContent = fmtCur(d.totalSpent);
  document.getElementById('statReach').textContent = fmt(d.totalReach);
  const tb = document.getElementById('recentCampaignsTable');
  if (!d.recentCampaigns.length) { tb.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No campaigns yet</td></tr>'; return; }
  tb.innerHTML = d.recentCampaigns.map(c => `<tr>
    <td><strong>${esc(c.campaign_name)}</strong></td><td>${esc(c.client_name)}</td><td>${esc(c.platform)}</td><td>${statusBadge(c.status)}</td>
    <td><button class="btn-icon" title="View" onclick="viewReport('${c.id}')"><i class="fa-solid fa-eye"></i></button>
    <button class="btn-icon" title="Edit" onclick="editCampaign('${c.id}')"><i class="fa-solid fa-pen"></i></button></td>
  </tr>`).join('');
}

// ============ CLIENTS ============
async function loadClients() {
  clients = await api('/clients') || [];
  const tb = document.getElementById('clientsTable');
  if (!clients.length) { tb.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No clients yet</td></tr>'; return; }
  tb.innerHTML = clients.map(cl => `<tr>
    <td><strong>${esc(cl.company_name)}</strong></td><td>${esc(cl.contact_person)}</td><td>${esc(cl.email)}</td><td>${esc(cl.industry)||'—'}</td>
    <td><button class="btn-icon" title="Edit" data-client-id="${cl.id}" onclick="editClientById(this.dataset.clientId)"><i class="fa-solid fa-pen"></i></button>
    ${currentUser?.role==='superadmin'?`<button class="btn-icon danger" title="Delete" onclick="deleteClient('${cl.id}')"><i class="fa-solid fa-trash"></i></button>`:''}</td>
  </tr>`).join('');
}

function showClientModal() {
  document.getElementById('clientModalTitle').textContent = 'Add Client';
  document.getElementById('clientId').value = '';
  ['clientCompany','clientContact','clientEmail','clientPhone','clientWebsite','clientNotes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('clientIndustry').value = '';
  document.getElementById('clientModal').classList.add('active');
}
function editClientById(id) {
  const cl = clients.find(c => c.id === id);
  if (!cl) return;
  editClient(cl);
}
function editClient(cl) {
  document.getElementById('clientModalTitle').textContent = 'Edit Client';
  document.getElementById('clientId').value = cl.id;
  document.getElementById('clientCompany').value = cl.company_name||'';
  document.getElementById('clientContact').value = cl.contact_person||'';
  document.getElementById('clientEmail').value = cl.email||'';
  document.getElementById('clientPhone').value = cl.phone||'';
  document.getElementById('clientIndustry').value = cl.industry||'';
  document.getElementById('clientWebsite').value = cl.website||'';
  document.getElementById('clientNotes').value = cl.notes||'';
  document.getElementById('clientModal').classList.add('active');
}
async function saveClient() {
  const id = document.getElementById('clientId').value;
  const data = {
    company_name: document.getElementById('clientCompany').value.trim(),
    contact_person: document.getElementById('clientContact').value.trim(),
    email: document.getElementById('clientEmail').value.trim(),
    phone: document.getElementById('clientPhone').value.trim(),
    industry: document.getElementById('clientIndustry').value,
    website: document.getElementById('clientWebsite').value.trim(),
    notes: document.getElementById('clientNotes').value.trim()
  };
  if (!data.company_name || !data.contact_person || !data.email) { showToast('Fill all required fields','error'); return; }
  if (id) { await api(`/clients/${id}`,'PUT',data); showToast('Client updated'); }
  else { await api('/clients','POST',data); showToast('Client added'); }
  closeModal('clientModal');
  loadClients();
}
async function deleteClient(id) {
  if (!confirm('Delete this client and all campaigns?')) return;
  await api(`/clients/${id}`,'DELETE');
  showToast('Client deleted');
  loadClients();
}

// ============ CAMPAIGNS ============
async function loadCampaigns() {
  [campaigns, clients] = await Promise.all([api('/campaigns'), api('/clients')]);
  campaigns = campaigns || []; clients = clients || [];
  const f = document.getElementById('filterClient');
  f.innerHTML = '<option value="">All Clients</option>' + clients.map(c=>`<option value="${c.id}">${esc(c.company_name)}</option>`).join('');
  renderCampaigns(campaigns);
}
function renderCampaigns(data) {
  const tb = document.getElementById('campaignsTable');
  if (!data.length) { tb.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No campaigns</td></tr>'; return; }
  tb.innerHTML = data.map(c => `<tr>
    <td><strong>${esc(c.campaign_name)}</strong></td><td>${esc(c.client_name)}</td><td>${esc(c.ad_type)}</td><td>${esc(c.objective)}</td><td>${statusBadge(c.status)}</td>
    <td><button class="btn-icon" title="View" onclick="viewReport('${c.id}')"><i class="fa-solid fa-eye"></i></button>
    <button class="btn-icon" title="Edit" onclick="editCampaign('${c.id}')"><i class="fa-solid fa-pen"></i></button>
    ${currentUser?.role==='superadmin'?`<button class="btn-icon danger" title="Delete" onclick="deleteCampaign('${c.id}')"><i class="fa-solid fa-trash"></i></button>`:''}</td>
  </tr>`).join('');
}
document.getElementById('filterClient')?.addEventListener('change', filterCampaigns);
document.getElementById('filterStatus')?.addEventListener('change', filterCampaigns);
function filterCampaigns() {
  const cid = document.getElementById('filterClient').value;
  const st = document.getElementById('filterStatus').value;
  let f = campaigns;
  if (cid) f = f.filter(c => c.client_id === cid);
  if (st) f = f.filter(c => c.status === st);
  renderCampaigns(f);
}
async function deleteCampaign(id) {
  if (!confirm('Delete this campaign?')) return;
  await api(`/campaigns/${id}`,'DELETE');
  showToast('Campaign deleted');
  loadCampaigns();
}

// ============ NEW CAMPAIGN (3-step) ============
async function loadNewCampaignPage() {
  clients = await api('/clients');
  const sel = document.getElementById('campaignClient');
  sel.innerHTML = '<option value="">Select Client</option>' + clients.map(c=>`<option value="${c.id}">${esc(c.company_name)}</option>`).join('');
  if (!currentCampaignId) { resetForms(); goToStep(1); document.getElementById('newCampaignTitle').textContent='Create New Report'; }
}
function resetForms() {
  currentCampaignId = null;
  ['campaignName','campaignNotes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('campaignClient').value = '';
  document.getElementById('campaignPlatform').value = 'Facebook';
  document.getElementById('campaignAdType').value = '';
  document.getElementById('campaignObjective').value = '';
  document.getElementById('campaignStartDate').value = '';
  document.getElementById('campaignEndDate').value = '';
  // Reset all metric inputs
  document.querySelectorAll('#step-2 input[type="number"]').forEach(i => i.value = '0');
  ['postTargetAudience','postTargetLocation','postTargetAgeRange'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('postTargetGender').value = 'All';
}
function goToStep(n) {
  document.querySelectorAll('.step-content').forEach(s => s.classList.remove('active'));
  document.getElementById(`step-${n}`).classList.add('active');
  document.querySelectorAll('.step').forEach(s => {
    const sn = parseInt(s.dataset.step);
    s.classList.remove('active','completed');
    if (sn === n) s.classList.add('active');
    else if (sn < n) s.classList.add('completed');
  });
  if (n === 3) generateReportPreview();
}

async function editCampaign(id) {
  currentCampaignId = id;
  navigateTo('new-campaign');
  const data = await api(`/campaigns/${id}`);
  const c = data.campaign;
  document.getElementById('newCampaignTitle').textContent = 'Edit: ' + c.campaign_name;
  document.getElementById('campaignClient').value = c.client_id;
  document.getElementById('campaignName').value = c.campaign_name;
  document.getElementById('campaignPlatform').value = c.platform;
  document.getElementById('campaignAdType').value = c.ad_type;
  document.getElementById('campaignObjective').value = c.objective;
  document.getElementById('campaignStartDate').value = c.start_date||'';
  document.getElementById('campaignEndDate').value = c.end_date||'';
  document.getElementById('campaignNotes').value = c.notes||'';
  if (data.preBoost) {
    const p = data.preBoost;
    document.getElementById('preReach').value = p.reach;
    document.getElementById('preImpressions').value = p.impressions;
    document.getElementById('preReactions').value = p.reactions;
    document.getElementById('preComments').value = p.comments;
    document.getElementById('preShares').value = p.shares;
    document.getElementById('preLinkClicks').value = p.link_clicks;
    document.getElementById('prePostSaves').value = p.post_saves;
    document.getElementById('prePageLikes').value = p.page_likes;
    document.getElementById('prePageFollowers').value = p.page_followers;
    document.getElementById('preProfileVisits').value = p.profile_visits;
    document.getElementById('preVideoViews').value = p.video_views;
  }
  if (data.postBoost) {
    const a = data.postBoost;
    document.getElementById('postReach').value = a.reach;
    document.getElementById('postImpressions').value = a.impressions;
    document.getElementById('postFrequency').value = a.frequency;
    document.getElementById('postReactions').value = a.reactions;
    document.getElementById('postComments').value = a.comments;
    document.getElementById('postShares').value = a.shares;
    document.getElementById('postLinkClicks').value = a.link_clicks;
    document.getElementById('postPostSaves').value = a.post_saves;
    document.getElementById('postPageLikes').value = a.page_likes;
    document.getElementById('postPageFollowers').value = a.page_followers;
    document.getElementById('postProfileVisits').value = a.profile_visits;
    document.getElementById('postVideoViews').value = a.video_views;
    document.getElementById('postAmountSpent').value = a.amount_spent;
    document.getElementById('postDurationDays').value = a.duration_days;
    document.getElementById('postCTR').value = a.ctr;
    document.getElementById('postCPC').value = a.cpc;
    document.getElementById('postCPM').value = a.cpm;
    document.getElementById('postConversions').value = a.conversions;
    document.getElementById('postLeads').value = a.leads;
    document.getElementById('postWebsiteVisits').value = a.website_visits;
    document.getElementById('postTargetAudience').value = a.target_audience||'';
    document.getElementById('postTargetLocation').value = a.target_location||'';
    document.getElementById('postTargetAgeRange').value = a.target_age_range||'';
    document.getElementById('postTargetGender').value = a.target_gender||'All';
  }
}

async function saveAndNext(step) {
  if (step === 1) {
    const clientId = document.getElementById('campaignClient').value;
    const name = document.getElementById('campaignName').value.trim();
    const adType = document.getElementById('campaignAdType').value;
    const objective = document.getElementById('campaignObjective').value;
    if (!clientId||!name||!adType||!objective) { showToast('Fill all required fields','error'); return; }
    const data = { client_id:clientId, campaign_name:name, platform:document.getElementById('campaignPlatform').value,
      ad_type:adType, objective, start_date:document.getElementById('campaignStartDate').value,
      end_date:document.getElementById('campaignEndDate').value, notes:document.getElementById('campaignNotes').value.trim() };
    if (currentCampaignId) { await api(`/campaigns/${currentCampaignId}`,'PUT',{...data,status:'draft'}); showToast('Campaign updated'); }
    else { const r = await api('/campaigns','POST',data); if (!r) return; currentCampaignId = r.id; showToast('Campaign created'); }
    goToStep(2);
  } else if (step === 2) {
    // Save pre-boost
    const pre = {
      reach: +document.getElementById('preReach').value||0,
      impressions: +document.getElementById('preImpressions').value||0,
      reactions: +document.getElementById('preReactions').value||0,
      comments: +document.getElementById('preComments').value||0,
      shares: +document.getElementById('preShares').value||0,
      link_clicks: +document.getElementById('preLinkClicks').value||0,
      post_saves: +document.getElementById('prePostSaves').value||0,
      page_likes: +document.getElementById('prePageLikes').value||0,
      page_followers: +document.getElementById('prePageFollowers').value||0,
      profile_visits: +document.getElementById('preProfileVisits').value||0,
      video_views: +document.getElementById('preVideoViews').value||0
    };
    await api(`/campaigns/${currentCampaignId}/pre-boost`,'POST',pre);

    // Save post-boost if any after-boost field > 0
    const postReach = +document.getElementById('postReach').value||0;
    if (postReach > 0) {
      const post = {
        reach: postReach,
        impressions: +document.getElementById('postImpressions').value||0,
        frequency: +document.getElementById('postFrequency').value||0,
        reactions: +document.getElementById('postReactions').value||0,
        comments: +document.getElementById('postComments').value||0,
        shares: +document.getElementById('postShares').value||0,
        link_clicks: +document.getElementById('postLinkClicks').value||0,
        post_saves: +document.getElementById('postPostSaves').value||0,
        page_likes: +document.getElementById('postPageLikes').value||0,
        page_followers: +document.getElementById('postPageFollowers').value||0,
        profile_visits: +document.getElementById('postProfileVisits').value||0,
        video_views: +document.getElementById('postVideoViews').value||0,
        amount_spent: +document.getElementById('postAmountSpent').value||0,
        duration_days: +document.getElementById('postDurationDays').value||0,
        ctr: +document.getElementById('postCTR').value||0,
        cpc: +document.getElementById('postCPC').value||0,
        cpm: +document.getElementById('postCPM').value||0,
        conversions: +document.getElementById('postConversions').value||0,
        leads: +document.getElementById('postLeads').value||0,
        website_visits: +document.getElementById('postWebsiteVisits').value||0,
        target_audience: document.getElementById('postTargetAudience').value.trim(),
        target_location: document.getElementById('postTargetLocation').value.trim(),
        target_age_range: document.getElementById('postTargetAgeRange').value.trim(),
        target_gender: document.getElementById('postTargetGender').value
      };
      await api(`/campaigns/${currentCampaignId}/post-boost`,'POST',post);
    }
    showToast('Metrics saved');
    goToStep(3);
  }
}

function finishAndSave() {
  showToast('Report saved successfully!');
  currentCampaignId = null;
  navigateTo('reports');
}

// ============ REPORT GENERATION ============
async function generateReportPreview() {
  if (!currentCampaignId) return;
  const data = await api(`/campaigns/${currentCampaignId}`);
  document.getElementById('reportPreview').innerHTML = buildReport(data);
  setTimeout(() => renderCharts(data), 150);
}

async function viewReport(id) {
  currentCampaignId = id;
  const data = await api(`/campaigns/${id}`);
  if (!data.preBoost && !data.postBoost) { showToast('No metrics yet','info'); editCampaign(id); return; }
  navigateTo('report-view');
  document.getElementById('reportViewContent').innerHTML = buildReport(data);
  setTimeout(() => renderCharts(data), 150);
}

function buildReport(data) {
  const { campaign: c, preBoost: pre, postBoost: post } = data;
  const hasPre = !!pre, hasPost = !!post;

  // Calculate derived metrics
  const preEng = hasPre ? (pre.reactions+pre.comments+pre.shares+pre.link_clicks+pre.post_saves) : 0;
  const postEng = hasPost ? (post.reactions+post.comments+post.shares+post.link_clicks+post.post_saves) : 0;
  const preEngRate = hasPre && pre.reach > 0 ? ((preEng/pre.reach)*100).toFixed(2) : '0.00';
  const postEngRate = hasPost && post.reach > 0 ? ((postEng/post.reach)*100).toFixed(2) : '0.00';
  const costPerEng = hasPost && postEng > 0 ? (post.amount_spent/postEng).toFixed(2) : '0.00';
  const costPerReach = hasPost && post.reach > 0 ? ((post.amount_spent/post.reach)*1000).toFixed(2) : '0.00';
  const reachGrowth = hasPre && hasPost && pre.reach > 0 ? (((post.reach-pre.reach)/pre.reach)*100).toFixed(0) : '0';
  const engGrowth = hasPre && hasPost && preEng > 0 ? (((postEng-preEng)/preEng)*100).toFixed(0) : '0';

  function chg(before, after) {
    if (!before && !after) return '<span class="comp-change neutral">—</span>';
    if (!before) return '<span class="comp-change positive">New</span>';
    const diff = after - before;
    const pct = before > 0 ? ((diff/before)*100).toFixed(0) : 0;
    if (diff > 0) return `<span class="comp-change positive">+${fmt(diff)} (↑${pct}%)</span>`;
    if (diff < 0) return `<span class="comp-change negative">${fmt(diff)} (↓${Math.abs(pct)}%)</span>`;
    return '<span class="comp-change neutral">No change</span>';
  }

  let html = `<div class="report-view" id="printableReport">
    <div class="report-header-section">
      <h2>${esc(c.campaign_name)}</h2>
      <div class="subtitle">Performance Report — ${esc(c.client_name)}</div>
      <div class="report-header-meta">
        <span><i class="fa-solid fa-building"></i> ${esc(c.client_name)}</span>
        <span><i class="fa-solid fa-mobile-screen"></i> ${esc(c.platform)}</span>
        <span><i class="fa-solid fa-tag"></i> ${esc(c.ad_type)}</span>
        <span><i class="fa-solid fa-bullseye"></i> ${esc(c.objective)}</span>
        ${c.start_date?`<span><i class="fa-solid fa-calendar"></i> ${c.start_date}${c.end_date?' → '+c.end_date:''}</span>`:''}
      </div>
    </div>`;

  // KEY RESULTS SUMMARY
  if (hasPost) {
    html += `<div class="report-section">
      <h3 class="report-section-title"><i class="fa-solid fa-star"></i> Key Results Summary</h3>
      <div class="summary-highlight">
        <div class="highlight-box"><span class="hl-value">${fmt(post.reach)}</span><span class="hl-label">People Reached</span>${hasPre?`<span class="hl-sub">↑ ${reachGrowth}% growth</span>`:''}</div>
        <div class="highlight-box"><span class="hl-value">${fmt(postEng)}</span><span class="hl-label">Total Engagements</span>${hasPre?`<span class="hl-sub">↑ ${engGrowth}% growth</span>`:''}</div>
        <div class="highlight-box"><span class="hl-value">${fmtCur(post.amount_spent)}</span><span class="hl-label">Amount Spent</span><span class="hl-sub">${post.duration_days} days</span></div>
        <div class="highlight-box"><span class="hl-value">${fmtCur(costPerEng)}</span><span class="hl-label">Cost Per Engagement</span></div>
      </div>
    </div>`;
  }

  // Targeting info
  if (hasPost && (post.target_audience || post.target_location)) {
    html += `<div class="report-section">
      <h3 class="report-section-title"><i class="fa-solid fa-crosshairs"></i> Audience Targeting</h3>
      <div class="metrics-grid">
        ${post.target_audience?`<div class="metric-box"><span class="metric-value" style="font-size:0.95rem">${esc(post.target_audience)}</span><span class="metric-label">Audience</span></div>`:''}
        ${post.target_location?`<div class="metric-box"><span class="metric-value" style="font-size:0.95rem">${esc(post.target_location)}</span><span class="metric-label">Location</span></div>`:''}
        ${post.target_age_range?`<div class="metric-box"><span class="metric-value" style="font-size:0.95rem">${esc(post.target_age_range)}</span><span class="metric-label">Age Range</span></div>`:''}
        ${post.target_gender?`<div class="metric-box"><span class="metric-value" style="font-size:0.95rem">${esc(post.target_gender)}</span><span class="metric-label">Gender</span></div>`:''}
      </div>
    </div>`;
  }

  // BEFORE vs AFTER COMPARISON
  if (hasPre && hasPost) {
    const metrics = [
      ['Reach', pre.reach, post.reach],
      ['Impressions', pre.impressions, post.impressions],
      ['Reactions', pre.reactions, post.reactions],
      ['Comments', pre.comments, post.comments],
      ['Shares', pre.shares, post.shares],
      ['Link Clicks', pre.link_clicks, post.link_clicks],
      ['Post Saves', pre.post_saves, post.post_saves],
      ['Page Likes', pre.page_likes, post.page_likes],
      ['Followers', pre.page_followers, post.page_followers],
      ['Profile Visits', pre.profile_visits, post.profile_visits],
      ['Video Views', pre.video_views, post.video_views],
      ['Engagement Rate', +preEngRate, +postEngRate]
    ];
    html += `<div class="report-section">
      <h3 class="report-section-title"><i class="fa-solid fa-arrows-left-right"></i> Before vs After Boost</h3>
      <div class="comparison-grid">${metrics.map(([label, b, a]) => `
        <div class="comparison-box">
          <span class="comp-label">${label}</span>
          <div class="comp-values">
            <span class="comp-before">${label.includes('Rate')?b+'%':fmt(b)}</span>
            <span class="comp-arrow">→</span>
            <span class="comp-after">${label.includes('Rate')?a+'%':fmt(a)}</span>
          </div>
          ${chg(b, a)}
        </div>`).join('')}
      </div>
    </div>`;

    // CHARTS
    html += `<div class="report-section">
      <h3 class="report-section-title"><i class="fa-solid fa-chart-bar"></i> Visual Analytics</h3>
      <div class="chart-row">
        <div class="chart-box"><h4>Reach & Impressions</h4><canvas id="chartReach" width="400" height="250"></canvas></div>
        <div class="chart-box"><h4>Engagement Breakdown</h4><canvas id="chartEngagement" width="400" height="250"></canvas></div>
      </div>
      <div class="chart-row" style="margin-top:0.75rem">
        <div class="chart-box"><h4>Engagement Composition (After)</h4><canvas id="chartPie" width="400" height="280"></canvas></div>
        <div class="chart-box"><h4>Page Growth</h4><canvas id="chartGrowth" width="400" height="250"></canvas></div>
      </div>
    </div>`;
  }

  // COST & PERFORMANCE
  if (hasPost) {
    html += `<div class="report-section">
      <h3 class="report-section-title"><i class="fa-solid fa-coins"></i> Cost & Performance</h3>
      <div class="metrics-grid">
        <div class="metric-box"><span class="metric-value">${fmtCur(post.amount_spent)}</span><span class="metric-label">Spent</span></div>
        <div class="metric-box"><span class="metric-value">${post.ctr?.toFixed(2)||'0.00'}%</span><span class="metric-label">CTR</span></div>
        <div class="metric-box"><span class="metric-value">${fmtCur(post.cpc)}</span><span class="metric-label">Cost/Click</span></div>
        <div class="metric-box"><span class="metric-value">${fmtCur(post.cpm)}</span><span class="metric-label">CPM</span></div>
        <div class="metric-box"><span class="metric-value">${fmtCur(costPerEng)}</span><span class="metric-label">Cost/Engagement</span></div>
        <div class="metric-box"><span class="metric-value">${fmtCur(costPerReach)}</span><span class="metric-label">Cost/1K Reach</span></div>
        <div class="metric-box"><span class="metric-value">${postEngRate}%</span><span class="metric-label">Engagement Rate</span></div>
        <div class="metric-box"><span class="metric-value">${post.frequency?.toFixed(2)||'0'}</span><span class="metric-label">Frequency</span></div>
      </div>
    </div>`;

    if (post.conversions > 0 || post.leads > 0 || post.website_visits > 0) {
      html += `<div class="report-section">
        <h3 class="report-section-title"><i class="fa-solid fa-bullseye"></i> Conversions & Results</h3>
        <div class="metrics-grid">
          <div class="metric-box"><span class="metric-value">${fmt(post.conversions)}</span><span class="metric-label">Conversions</span></div>
          <div class="metric-box"><span class="metric-value">${fmt(post.leads)}</span><span class="metric-label">Leads</span></div>
          <div class="metric-box"><span class="metric-value">${fmt(post.website_visits)}</span><span class="metric-label">Website Visits</span></div>
        </div>
      </div>`;
    }
  }

  // Pre-boost only view
  if (hasPre && !hasPost) {
    html += `<div class="report-section">
      <h3 class="report-section-title"><i class="fa-solid fa-chart-simple"></i> Organic Performance</h3>
      <div class="metrics-grid">
        <div class="metric-box"><span class="metric-value">${fmt(pre.reach)}</span><span class="metric-label">Reach</span></div>
        <div class="metric-box"><span class="metric-value">${fmt(pre.impressions)}</span><span class="metric-label">Impressions</span></div>
        <div class="metric-box"><span class="metric-value">${fmt(preEng)}</span><span class="metric-label">Engagement</span></div>
        <div class="metric-box"><span class="metric-value">${fmt(pre.reactions)}</span><span class="metric-label">Reactions</span></div>
        <div class="metric-box"><span class="metric-value">${fmt(pre.comments)}</span><span class="metric-label">Comments</span></div>
        <div class="metric-box"><span class="metric-value">${fmt(pre.shares)}</span><span class="metric-label">Shares</span></div>
        <div class="metric-box"><span class="metric-value">${preEngRate}%</span><span class="metric-label">Engagement Rate</span></div>
      </div>
    </div>`;
  }

  html += `<div class="report-footer">
    <p><strong>MetaPulse</strong> Analytics Report • Generated ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</p>
    <p>Prepared for ${esc(c.client_name)} • Confidential</p>
  </div></div>`;
  return html;
}

function renderCharts(data) {
  const { preBoost: pre, postBoost: post } = data;
  if (!pre || !post) return;
  Object.values(chartInstances).forEach(c => c?.destroy());
  chartInstances = {};
  const colors = { b:'#1877F2', p:'#8B5CF6', g:'#10B981', o:'#F59E0B', pk:'#EC4899', bl:'rgba(24,119,242,0.55)', pl:'rgba(139,92,246,0.55)', gl:'rgba(16,185,129,0.45)' };
  const barOpts = { responsive:true, maintainAspectRatio:true, animation:false, plugins:{legend:{position:'bottom',labels:{boxWidth:12,font:{size:11}}}}, scales:{y:{beginAtZero:true}} };

  const el1 = document.getElementById('chartReach');
  if (el1) chartInstances.r = new Chart(el1, { type:'bar', data:{ labels:['Reach','Impressions'], datasets:[
    {label:'Before',data:[pre.reach,pre.impressions],backgroundColor:colors.bl,borderColor:colors.b,borderWidth:2,borderRadius:6},
    {label:'After',data:[post.reach,post.impressions],backgroundColor:colors.pl,borderColor:colors.p,borderWidth:2,borderRadius:6}
  ]}, options:barOpts });

  const el2 = document.getElementById('chartEngagement');
  if (el2) chartInstances.e = new Chart(el2, { type:'bar', data:{ labels:['Reactions','Comments','Shares','Clicks','Saves'], datasets:[
    {label:'Before',data:[pre.reactions,pre.comments,pre.shares,pre.link_clicks,pre.post_saves],backgroundColor:colors.bl,borderColor:colors.b,borderWidth:2,borderRadius:6},
    {label:'After',data:[post.reactions,post.comments,post.shares,post.link_clicks,post.post_saves],backgroundColor:colors.pl,borderColor:colors.p,borderWidth:2,borderRadius:6}
  ]}, options:barOpts });

  const el3 = document.getElementById('chartPie');
  if (el3) chartInstances.p = new Chart(el3, { type:'doughnut', data:{ labels:['Reactions','Comments','Shares','Clicks','Saves'], datasets:[{
    data:[post.reactions,post.comments,post.shares,post.link_clicks,post.post_saves],
    backgroundColor:[colors.b,colors.p,colors.g,colors.o,colors.pk],borderWidth:0
  }]}, options:{responsive:true,maintainAspectRatio:true,animation:false,plugins:{legend:{position:'bottom',labels:{boxWidth:12,font:{size:11}}}}} });

  const el4 = document.getElementById('chartGrowth');
  if (el4) chartInstances.g = new Chart(el4, { type:'bar', data:{ labels:['Page Likes','Followers','Profile Visits'], datasets:[
    {label:'Before',data:[pre.page_likes,pre.page_followers,pre.profile_visits],backgroundColor:colors.bl,borderColor:colors.b,borderWidth:2,borderRadius:6},
    {label:'After',data:[post.page_likes,post.page_followers,post.profile_visits],backgroundColor:colors.gl,borderColor:colors.g,borderWidth:2,borderRadius:6}
  ]}, options:barOpts });
}

// ============ REPORTS PAGE ============
async function loadReportsPage() {
  clients = await api('/clients');
  const f = document.getElementById('reportFilterClient');
  f.innerHTML = '<option value="">All Clients</option>' + clients.map(c=>`<option value="${c.id}">${esc(c.company_name)}</option>`).join('');
  loadReportsList();
}
document.getElementById('reportFilterClient')?.addEventListener('change', loadReportsList);

async function loadReportsList() {
  const cid = document.getElementById('reportFilterClient').value;
  let url = '/campaigns';
  if (cid) url += `?client_id=${cid}`;
  const all = await api(url);
  if (!all) return;
  const container = document.getElementById('reportsList');
  // Fetch campaign details in parallel instead of sequentially
  const results = await Promise.all(all.map(c => api(`/campaigns/${c.id}`)));
  const withData = results.filter(r => r && (r.preBoost || r.postBoost)).map((full, i) => ({...all[i], ...full}));
  if (!withData.length) { container.innerHTML = '<div class="text-center text-muted" style="grid-column:1/-1;padding:3rem;">No reports yet</div>'; return; }
  container.innerHTML = withData.map(c => {
    const post = c.postBoost, pre = c.preBoost;
    const eng = post ? (post.reactions+post.comments+post.shares+post.link_clicks+post.post_saves) : pre ? (pre.reactions+pre.comments+pre.shares+pre.link_clicks+pre.post_saves) : 0;
    return `<div class="report-card" onclick="viewReport('${c.id}')">
      <div class="report-card-header"><h4>${esc(c.campaign_name)}</h4><div class="report-card-meta"><span>${esc(c.client_name)}</span><span>${esc(c.platform)}</span>${statusBadge(c.status)}</div></div>
      <div class="report-card-body">
        <div class="report-mini-stat"><span class="value">${fmt(post?.reach||pre?.reach||0)}</span><span class="label">Reach</span></div>
        <div class="report-mini-stat"><span class="value">${fmt(eng)}</span><span class="label">Engagement</span></div>
        <div class="report-mini-stat"><span class="value">${post?fmtCur(post.amount_spent):'—'}</span><span class="label">Spent</span></div>
      </div>
      <div class="report-card-footer">
        <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();viewReport('${c.id}')"><i class="fa-solid fa-eye"></i> View</button>
        <button class="btn btn-sm btn-success" onclick="event.stopPropagation();exportSinglePDF('${c.id}')"><i class="fa-solid fa-file-pdf"></i> PDF</button>
      </div>
    </div>`;
  }).join('');
}

// ============ PDF EXPORT ============
function exportPDF() {
  const el = document.getElementById('printableReport');
  if (!el) { showToast('No report to export','error'); return; }
  showToast('Generating PDF...','info');
  html2pdf().set({
    margin:[10,10,10,10], filename:'campaign-report.pdf',
    image:{type:'png',quality:1}, html2canvas:{scale:2,useCORS:true,backgroundColor:'#ffffff'},
    jsPDF:{unit:'mm',format:'a4',orientation:'portrait'}, pagebreak:{mode:['avoid-all','css','legacy']}
  }).from(el).save().then(() => showToast('PDF exported!'));
}
async function exportSinglePDF(id) {
  const data = await api(`/campaigns/${id}`);
  if (!data) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = buildReport(data);
  // Use unique IDs for chart canvases to avoid collisions
  const suffix = '_pdf_' + Date.now();
  tmp.querySelectorAll('canvas').forEach(c => { c.id = c.id + suffix; });
  tmp.style.cssText = 'position:absolute;left:-9999px;width:800px';
  document.body.appendChild(tmp);
  // Render charts into the tmp container's canvases
  const { preBoost: pre, postBoost: post } = data;
  if (pre && post) {
    const colors = { b:'#1877F2', p:'#8B5CF6', g:'#10B981', o:'#F59E0B', pk:'#EC4899', bl:'rgba(24,119,242,0.55)', pl:'rgba(139,92,246,0.55)', gl:'rgba(16,185,129,0.45)' };
    const barOpts = { responsive:true, maintainAspectRatio:true, animation:false, plugins:{legend:{position:'bottom',labels:{boxWidth:12,font:{size:11}}}}, scales:{y:{beginAtZero:true}} };
    const el1 = document.getElementById('chartReach'+suffix);
    if (el1) new Chart(el1, { type:'bar', data:{ labels:['Reach','Impressions'], datasets:[{label:'Before',data:[pre.reach,pre.impressions],backgroundColor:colors.bl,borderColor:colors.b,borderWidth:2,borderRadius:6},{label:'After',data:[post.reach,post.impressions],backgroundColor:colors.pl,borderColor:colors.p,borderWidth:2,borderRadius:6}]}, options:barOpts });
    const el2 = document.getElementById('chartEngagement'+suffix);
    if (el2) new Chart(el2, { type:'bar', data:{ labels:['Reactions','Comments','Shares','Clicks','Saves'], datasets:[{label:'Before',data:[pre.reactions,pre.comments,pre.shares,pre.link_clicks,pre.post_saves],backgroundColor:colors.bl,borderColor:colors.b,borderWidth:2,borderRadius:6},{label:'After',data:[post.reactions,post.comments,post.shares,post.link_clicks,post.post_saves],backgroundColor:colors.pl,borderColor:colors.p,borderWidth:2,borderRadius:6}]}, options:barOpts });
    const el3 = document.getElementById('chartPie'+suffix);
    if (el3) new Chart(el3, { type:'doughnut', data:{ labels:['Reactions','Comments','Shares','Clicks','Saves'], datasets:[{data:[post.reactions,post.comments,post.shares,post.link_clicks,post.post_saves],backgroundColor:[colors.b,colors.p,colors.g,colors.o,colors.pk],borderWidth:0}]}, options:{responsive:true,maintainAspectRatio:true,animation:false,plugins:{legend:{position:'bottom',labels:{boxWidth:12,font:{size:11}}}}} });
    const el4 = document.getElementById('chartGrowth'+suffix);
    if (el4) new Chart(el4, { type:'bar', data:{ labels:['Page Likes','Followers','Profile Visits'], datasets:[{label:'Before',data:[pre.page_likes,pre.page_followers,pre.profile_visits],backgroundColor:colors.bl,borderColor:colors.b,borderWidth:2,borderRadius:6},{label:'After',data:[post.page_likes,post.page_followers,post.profile_visits],backgroundColor:colors.gl,borderColor:colors.g,borderWidth:2,borderRadius:6}]}, options:barOpts });
  }
  await new Promise(r => setTimeout(r, 500));
  const report = tmp.querySelector('.report-view');
  showToast('Generating PDF...','info');
  html2pdf().set({
    margin:[10,10,10,10], filename:`${data.campaign.campaign_name.replace(/[^a-zA-Z0-9]/g,'_')}-report.pdf`,
    image:{type:'png',quality:1}, html2canvas:{scale:2,useCORS:true,backgroundColor:'#ffffff'},
    jsPDF:{unit:'mm',format:'a4',orientation:'portrait'}, pagebreak:{mode:['avoid-all','css','legacy']}
  }).from(report).save().then(() => { tmp.remove(); showToast('PDF exported!'); });
}

// ============ USERS (Admin) ============
async function loadUsers() {
  if (currentUser?.role !== 'superadmin') return;
  const users = await api('/users');
  const tb = document.getElementById('usersTable');
  window._usersCache = users;
  tb.innerHTML = users.map(u => `<tr>
    <td><strong>${esc(u.full_name)}</strong></td><td>${esc(u.email)}</td>
    <td><span class="badge badge-${u.role}">${u.role==='superadmin'?'Admin':'Employee'}</span></td>
    <td><span class="badge ${u.is_active?'badge-active':'badge-inactive'}">${u.is_active?'Active':'Inactive'}</span></td>
    <td><button class="btn-icon" title="Edit" data-user-id="${u.id}" onclick="editUserById(this.dataset.userId)"><i class="fa-solid fa-pen"></i></button>
    ${u.id!==currentUser.id?`<button class="btn-icon danger" title="Delete" onclick="deleteUser('${u.id}')"><i class="fa-solid fa-trash"></i></button>`:''}</td>
  </tr>`).join('');
}
function showUserModal() {
  document.getElementById('userModalTitle').textContent = 'Add Team Member';
  document.getElementById('userId').value = '';
  document.getElementById('userFullName').value = '';
  document.getElementById('userEmail').value = '';
  document.getElementById('userPassword').value = '';
  document.getElementById('userRoleSelect').value = 'employee';
  document.getElementById('userPwLabel').textContent = 'Password';
  document.getElementById('userPassword').required = true;
  document.getElementById('userModal').classList.add('active');
}
function editUserById(id) {
  const u = (window._usersCache || []).find(u => u.id === id);
  if (!u) return;
  editUser(u);
}
function editUser(u) {
  document.getElementById('userModalTitle').textContent = 'Edit: ' + u.full_name;
  document.getElementById('userId').value = u.id;
  document.getElementById('userFullName').value = u.full_name;
  document.getElementById('userEmail').value = u.email;
  document.getElementById('userPassword').value = '';
  document.getElementById('userPassword').required = false;
  document.getElementById('userPwLabel').textContent = 'New Password (leave blank to keep)';
  document.getElementById('userRoleSelect').value = u.role;
  document.getElementById('userModal').classList.add('active');
}
async function saveUser() {
  const id = document.getElementById('userId').value;
  const data = {
    full_name: document.getElementById('userFullName').value.trim(),
    email: document.getElementById('userEmail').value.trim(),
    role: document.getElementById('userRoleSelect').value,
    is_active: 1
  };
  const pw = document.getElementById('userPassword').value;
  if (!data.full_name || !data.email) { showToast('Name and email required','error'); return; }
  if (!id && (!pw || pw.length < 6)) { showToast('Password must be at least 6 characters','error'); return; }
  if (pw) data.password = pw;
  if (id) { await api(`/users/${id}`,'PUT',data); showToast('User updated'); }
  else { await api('/users','POST',data); showToast('User added'); }
  closeModal('userModal');
  loadUsers();
}
async function deleteUser(id) {
  if (!confirm('Delete this team member?')) return;
  await api(`/users/${id}`,'DELETE');
  showToast('User deleted');
  loadUsers();
}
async function changePassword() {
  const cur = document.getElementById('currentPw').value;
  const nw = document.getElementById('newPw').value;
  if (!cur || !nw) { showToast('Both fields required','error'); return; }
  if (nw.length < 6) { showToast('Min 6 characters','error'); return; }
  const res = await fetch('/api/auth/password', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({current_password:cur,new_password:nw}) });
  const d = await res.json();
  if (!res.ok) { showToast(d.error,'error'); return; }
  showToast('Password changed!');
  closeModal('pwModal');
}

// ============ ACTIVITY LOG ============
async function loadActivity() {
  if (currentUser?.role !== 'superadmin') return;
  const logs = await api('/activity');
  const tb = document.getElementById('activityTable');
  if (!logs.length) { tb.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No activity yet</td></tr>'; return; }
  tb.innerHTML = logs.map(l => {
    const actionMap = { login:'Logged in', create_client:'Added client', update_client:'Updated client', delete_client:'Deleted client',
      create_campaign:'Created campaign', update_campaign:'Updated campaign', delete_campaign:'Deleted campaign',
      update_pre_boost:'Updated pre-boost', update_post_boost:'Updated post-boost',
      create_user:'Added user', update_user:'Updated user', delete_user:'Deleted user' };
    return `<tr>
      <td><strong>${esc(l.user_name||'System')}</strong></td>
      <td>${actionMap[l.action]||l.action}</td>
      <td>${esc(l.details)||'—'}</td>
      <td>${new Date(l.created_at+'Z').toLocaleString()}</td>
    </tr>`;
  }).join('');
}

// ============ SEARCH ============
document.getElementById('globalSearch')?.addEventListener('input', function() {
  const q = this.value.toLowerCase().trim();
  if (q.length < 2) return;
  const active = document.querySelector('.page.active');
  if (active?.id === 'page-clients') {
    const f = clients.filter(c => c.company_name.toLowerCase().includes(q) || c.contact_person.toLowerCase().includes(q) || c.email.toLowerCase().includes(q));
    const tb = document.getElementById('clientsTable');
    if (!f.length) { tb.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No results</td></tr>'; return; }
    tb.innerHTML = f.map(cl => `<tr><td><strong>${esc(cl.company_name)}</strong></td><td>${esc(cl.contact_person)}</td><td>${esc(cl.email)}</td><td>${esc(cl.industry)||'—'}</td>
    <td><button class="btn-icon" data-client-id="${cl.id}" onclick="editClientById(this.dataset.clientId)"><i class="fa-solid fa-pen"></i></button></td></tr>`).join('');
  } else if (active?.id === 'page-campaigns') {
    renderCampaigns(campaigns.filter(c => c.campaign_name.toLowerCase().includes(q) || c.client_name.toLowerCase().includes(q)));
  }
});

// ============ INIT ============
window.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  loadDashboard();
});

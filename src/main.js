import './style.css'

const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const statusBadge = document.getElementById('connection-status');
const profileData = document.getElementById('profile-data');
const statusTimeline = document.getElementById('status-timeline');
const typingStatus = document.getElementById('typing-status');
const contextCards = document.getElementById('context-cards');

// Configuration
const BASE_URL = 'http://127.0.0.1:4110/chat-bot';
const SESSION_ID = localStorage.getItem('genie_session_id') || ('genie-user-' + Math.random().toString(36).substring(7));
localStorage.setItem('genie_session_id', SESSION_ID);

let currentGenieMessage = null;
let currentFullText = '';
let eventSource = null;
let profileEntities = {};

/**
 * Appends a message bubble to the chat area
 */
function appendMessage(role, text) {
  // Remove welcome banner if it exists on first message
  const welcomeBanner = document.querySelector('.welcome-banner');
  if (welcomeBanner) welcomeBanner.remove();

  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = renderMarkdown(text);

  messageDiv.appendChild(bubble);
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  return messageDiv;
}

/**
 * Lightweight Markdown Parser
 */
function renderMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" class="chat-link">$1</a>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>')
    .replace(/^\* (.*)/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
}

/**
 * Updates the Student Profile in Sidebar with correct backend keys
 */
function updateProfile(entities) {
  if (!entities || Object.keys(entities).length === 0) return;

  // Merge new entities carefully
  profileEntities = { ...profileEntities, ...entities };

  profileData.innerHTML = '';
  const mapping = [
    { key: 'studentNationality', label: 'Nationality' },
    { key: 'desiredLocation', label: 'Destination' },
    { key: 'preferredCourseLevel', label: 'Degree Level' },
    { key: 'subjects', label: 'Study Subject' }
  ];

  // Intake formatting
  const month = profileEntities.preferredIntakeMonth || '';
  const year = profileEntities.preferredIntakeYear || '';
  if (month || year) {
    profileEntities.intake_display = `${month} ${year}`.trim();
  }

  const finalMapping = [...mapping, { key: 'intake_display', label: 'Preferred Intake' }];

  let hasData = false;
  finalMapping.forEach(m => {
    let val = profileEntities[m.key];
    if (Array.isArray(val)) val = val.join(', ');
    if (val) {
      const item = document.createElement('div');
      item.className = 'profile-item';
      item.innerHTML = `<label>${m.label}</label><span>${val}</span>`;
      profileData.appendChild(item);
      hasData = true;
    }
  });

  if (!hasData) {
    profileData.innerHTML = '<div class="profile-item empty">Building your profile...</div>';
  }
}

/**
 * Updates the Right Tray Timeline
 */
function updateTimeline(status) {
  statusTimeline.classList.remove('hidden');
  const steps = statusTimeline.querySelectorAll('.t-step');

  let activeStep = 'analyzing';
  const msg = status.toLowerCase();

  if (msg.includes('search') || msg.includes('retriev') || msg.includes('intent')) activeStep = 'retrieving';
  if (msg.includes('think') || msg.includes('format') || msg.includes('generat') || msg.includes('writ')) activeStep = 'responding';

  typingStatus.textContent = status + '...';

  steps.forEach(step => {
    const stepType = step.getAttribute('data-step');
    step.classList.remove('active', 'complete');

    if (stepType === activeStep) {
      step.classList.add('active');
    } else if (
      (activeStep === 'retrieving' && stepType === 'analyzing') ||
      (activeStep === 'responding' && (stepType === 'analyzing' || stepType === 'retrieving'))
    ) {
      step.classList.add('complete');
    }
  });
}

function resetTimeline() {
  const steps = statusTimeline.querySelectorAll('.t-step');
  steps.forEach(s => s.classList.remove('active', 'complete'));
  typingStatus.textContent = 'Ready to help';
}

/**
 * Renders University/Course cards in Right Tray
 */
function addContextCard(item) {
  if (!item) return;

  // Clear placeholder if first card
  const placeholder = contextCards.querySelector('.insight-placeholder');
  if (placeholder) placeholder.remove();

  const card = document.createElement('div');
  card.className = 'rich-card';

  const name = item.name || item.institution?.name || 'Academic Listing';
  const institution = item.institution?.name || item.location || 'Recommendation';
  const fee = item.approxAnnualFee ? `${item.currency || 'GBP'} ${item.approxAnnualFee}` : 'Variable Fees';
  const summary = item.courseSummary || item.description || 'Matching your professional and educational goals.';

  card.innerHTML = `
    <div class="card-header"><h4>Course Opportunity</h4></div>
    <div class="card-body">
      <strong>${name}</strong><br>
      <small>${institution}</small><br><br>
      ${summary.substring(0, 100)}...<br><br>
      <span style="color: #3fb950; font-weight: 600;">Est. Fee: ${fee}</span>
    </div>
    <div class="card-footer"><button class="btn-sm">View Details</button></div>
  `;
  contextCards.prepend(card);
}

/**
 * Initialize SSE Connection
 */
function initSSE() {
  if (eventSource) return;

  const streamUrl = `${BASE_URL}/chat-stream/${SESSION_ID}`;
  eventSource = new EventSource(streamUrl);

  eventSource.onopen = () => {
    statusBadge.textContent = 'Connected';
    document.querySelector('.pulse').style.background = '#3fb950';
  };

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('SSE Event:', data);

      switch (data.type) {
        case 'processing_started':
          currentGenieMessage = null;
          currentFullText = '';
          updateTimeline('Processing Request');
          break;

        case 'status_update':
          updateTimeline(data.data?.message || 'Working');
          break;

        case 'initial_processing_complete':
          if (data.data?.entities || data.data?.current_slots) {
            updateProfile(data.data.entities || data.data.current_slots);
          }
          break;

        case 'content_chunk':
        case 'ai_response':
          resetTimeline();
          if (!currentGenieMessage) {
            currentGenieMessage = appendMessage('genie', '');
          }
          const textChunk = data.data?.text || data.text_chunk || '';
          currentFullText += textChunk;
          currentGenieMessage.querySelector('.bubble').innerHTML = renderMarkdown(currentFullText);
          chatMessages.scrollTop = chatMessages.scrollHeight;
          break;

        case 'ai_response_completed':
        case 'stream_end':
          console.log('Task Completed');

          // Fallback for immediate responses
          if (!currentFullText && data.data?.text) {
            appendMessage('genie', data.data.text);
          }

          // Update profile from final entities
          if (data.data?.entities) {
            updateProfile(data.data.entities);
          }

          // If search results exist, show them in cards
          if (data.data?.items) {
            data.data.items.forEach(item => {
              addContextCard(item);
            });
          }
          if (data.data?.sources) {
            data.data.sources.forEach(item => {
              addContextCard(item);
            });
          }

          resetTimeline();
          currentGenieMessage = null;
          currentFullText = '';
          userInput.disabled = false;
          sendBtn.disabled = false;
          userInput.focus();
          break;

        case 'error':
          resetTimeline();
          const errorMsg = data.data?.message || data.message || "I'm having trouble connecting to my brain. Please try again.";
          appendMessage('genie', `<span style="color: #f85149">${errorMsg}</span>`);
          userInput.disabled = false;
          sendBtn.disabled = false;
          break;
      }
    } catch (err) {
      console.error('SSE JSON Error:', err);
    }
  };

  eventSource.onerror = (err) => {
    console.error('SSE Fatal Error:', err);
    statusBadge.textContent = 'Connection Offline';
    document.querySelector('.pulse').style.background = '#f85149';
    eventSource.close();
    eventSource = null;
    setTimeout(initSSE, 3000);
  };
}

initSSE();

/**
 * Handle form submission
 */
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = userInput.value.trim();
  if (!query) return;

  userInput.value = '';
  appendMessage('user', query);
  updateTimeline('Analyzing Query');

  userInput.disabled = true;
  sendBtn.disabled = true;

  try {
    const response = await fetch(`${BASE_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: SESSION_ID,
        message: query,
        metadata: { platform: 'genie-pro-v3', tier: 'premium' }
      }),
    });
    if (!response.ok) throw new Error('API Rejection');
  } catch (err) {
    console.error('Submission Error:', err);
    appendMessage('genie', 'Connection interrupted. Please check your internet or retry.');
    resetTimeline();
    userInput.disabled = false;
    sendBtn.disabled = false;
  }
});

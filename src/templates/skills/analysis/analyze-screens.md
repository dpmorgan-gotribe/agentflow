# Analyze Screens & Components

Extract all screens from flows and map required UI components for each screen.

## Output Requirements

OUTPUT ONLY RAW JSON. No explanations. No descriptions.

Your response must:
- Start with `{`
- End with `}`
- Be valid JSON
- Follow the output format below exactly

DO NOT:
- Explain what you're creating
- Ask for permission
- Wrap in markdown code fences (```)
- Add any text before or after the JSON
- Say "Now I have..." or "Let me..." or "Here's the..."

## Inputs
- flows.md (user journeys with screen sequences)
- Project brief (for understanding feature complexity)

## Process

1. **Parse Each Flow**:
   - Find each `## Flow N: [Name]` section
   - Extract flow ID from name (lowercase, hyphenated)
   - Extract screen names from `**Screens**:` line
   - Parse the numbered sequence: `1. [Welcome] → 2. [Sign Up] → ...`

2. **Generate Screen Files**:
   - Convert screen names to filenames (lowercase, hyphenated, .html)
   - Example: "Profile Setup" → "profile-setup.html"

3. **Identify Components Per Screen**:
   For each screen, determine what UI components it needs:

   **Navigation Components:**
   - `header` - Top navigation bar with logo, icons
   - `bottom-nav` - Bottom tab navigation
   - `side-menu` - Slide-out navigation drawer
   - `tab-bar` - Horizontal tabs within content
   - `breadcrumb` - Navigation breadcrumbs

   **Content Components:**
   - `card` - Content container (variants: event-card, tribe-card, job-card, etc.)
   - `list-item` - Row in a list
   - `avatar` - User/entity profile image
   - `badge` - Status indicator, notification count
   - `tag` - Category/label pill
   - `stat-card` - Metric display box
   - `progress-bar` - Progress indicator
   - `story-circle` - Circular story/avatar preview

   **Form Components:**
   - `form-input` - Text input field
   - `form-textarea` - Multi-line text input
   - `form-select` - Dropdown select
   - `checkbox` - Checkbox input
   - `radio` - Radio button group
   - `toggle` - On/off switch
   - `date-picker` - Date selection
   - `time-picker` - Time selection
   - `file-upload` - File upload input
   - `search-bar` - Search input with icon

   **Button Components:**
   - `button-primary` - Primary action button
   - `button-secondary` - Secondary action button
   - `button-icon` - Icon-only button
   - `fab` - Floating action button

   **Feedback Components:**
   - `modal` - Overlay dialog
   - `toast` - Notification popup
   - `empty-state` - No content placeholder
   - `loading` - Loading spinner/skeleton
   - `error-state` - Error message display

   **Layout Components:**
   - `filter-pills` - Horizontal filter buttons
   - `section-header` - Section title with optional action
   - `divider` - Content separator
   - `grid` - Card grid layout
   - `carousel` - Swipeable content

   **Rich Content:**
   - `image-gallery` - Multiple images
   - `video-player` - Video embed
   - `map` - Location map
   - `calendar` - Calendar view
   - `chart` - Data visualization

4. **Build Component List**:
   - Collect all unique components across all screens
   - Deduplicate the list

5. **Build Screen-Component Mapping**:
   - For each screen, list its required components

6. **Identify Icons Per Screen**:
   For each screen, determine what icons it needs:

   **Navigation Icons:**
   - `home` - Home/feed navigation
   - `search` - Search functionality
   - `menu` - Hamburger menu
   - `arrow_back` - Back navigation
   - `close` - Close/dismiss
   - `expand_content` - Expand/fullscreen

   **Tab/Section Icons:**
   - `camping` - Tribes/communities (tent icon)
   - `event` - Events/calendar
   - `chat` - Messages/chat
   - `account` - Profile/account
   - `notifications` - Notifications bell
   - `settings` - Settings gear

   **Feature Icons:**
   - `following` - Following/favorites (heart)
   - `donars` - Donors/fundraising
   - `offerings` - Offerings/services
   - `shops` - Marketplace/shops
   - `jobs` - Jobs board
   - `kitchen` - Kitchen/community features
   - `card` - Discovery/cards view
   - `lists` - Lists/menu items

   **Action Icons:**
   - `add` - Add/create new
   - `filter` - Filter/sort

7. **Build Icon List**:
   - Collect all unique icons across all screens
   - Deduplicate the list

8. **Build Screen-Icon Mapping**:
   - For each screen, list its required icons

## Output Format

```json
{
  "screens": [
    "welcome.html",
    "sign-up.html",
    "profile-setup.html",
    "home.html",
    "discover.html",
    "tribe-profile.html"
  ],
  "userflows": [
    {
      "id": "onboarding",
      "name": "Onboarding",
      "screens": [
        { "id": "welcome", "name": "Welcome", "file": "welcome.html" },
        { "id": "sign-up", "name": "Sign Up", "file": "sign-up.html" },
        { "id": "profile-setup", "name": "Profile Setup", "file": "profile-setup.html" },
        { "id": "home", "name": "Home", "file": "home.html" }
      ]
    }
  ],
  "components": [
    "header",
    "bottom-nav",
    "button-primary",
    "button-secondary",
    "form-input",
    "card",
    "avatar",
    "badge",
    "modal",
    "empty-state",
    "filter-pills",
    "search-bar",
    "tab-bar",
    "list-item",
    "progress-bar",
    "stat-card",
    "story-circle",
    "checkbox",
    "radio",
    "toggle",
    "form-select",
    "form-textarea",
    "date-picker",
    "toast",
    "loading",
    "section-header",
    "tag",
    "image-gallery",
    "fab"
  ],
  "screenComponents": {
    "welcome": ["header", "button-primary", "image-gallery"],
    "sign-up": ["header", "form-input", "button-primary", "checkbox"],
    "profile-setup": ["header", "bottom-nav", "form-input", "form-select", "avatar", "button-primary", "progress-bar"],
    "home": ["header", "bottom-nav", "search-bar", "filter-pills", "story-circle", "card", "section-header"],
    "discover": ["header", "bottom-nav", "search-bar", "filter-pills", "card", "map", "tab-bar"],
    "tribe-profile": ["header", "modal", "avatar", "badge", "stat-card", "tab-bar", "button-primary", "button-secondary"]
  },
  "icons": [
    "home", "search", "menu", "arrow_back", "close",
    "camping", "event", "chat", "account", "notifications", "settings",
    "following", "donars", "offerings", "shops", "jobs", "filter", "add"
  ],
  "screenIcons": {
    "welcome": ["menu"],
    "sign-up": ["arrow_back"],
    "profile-setup": ["arrow_back", "home", "camping", "event", "chat", "account"],
    "home": ["menu", "search", "notifications", "account", "home", "camping", "event", "chat"],
    "discover": ["menu", "search", "filter", "notifications", "account"],
    "tribe-profile": ["arrow_back", "notifications", "chat", "camping"]
  }
}
```

## Component Selection Guidelines

**Onboarding/Auth Screens**: header, form-input, button-primary, checkbox, progress-bar
**Home/Feed Screens**: header, bottom-nav, story-circle, card, filter-pills, section-header, search-bar
**List/Directory Screens**: header, bottom-nav, search-bar, filter-pills, list-item or card, empty-state
**Detail/Profile Screens**: header, avatar, badge, stat-card, tab-bar, button-primary, image-gallery
**Form/Creation Screens**: header, form-input, form-textarea, form-select, checkbox, radio, toggle, button-primary, button-secondary
**Settings Screens**: header, list-item, toggle, button-secondary
**Modal/Overlay Screens**: modal, button-primary, button-secondary
**Dashboard Screens**: header, stat-card, chart, progress-bar, section-header

## Icon Selection Guidelines

**Header Icons**: menu, search, notifications, account, filter, settings
**Bottom Nav Icons**: home, camping, event, chat, account
**Back/Close Icons**: arrow_back, close
**Feature Icons**: following, donars, offerings, shops, jobs, kitchen
**Action Icons**: add, filter, expand_content

## Notes

- The `screens` array should be deduplicated (no duplicates)
- The `components` array should be deduplicated
- The `icons` array should be deduplicated
- Every screen in `screenComponents` must have at least `header` or appropriate navigation
- Every screen should identify icons used in header, footer, and content
- Complex screens may have 10+ components and 5+ icons
- Simple screens may have 3-5 components and 1-3 icons
- Use the user icon names provided if available (e.g., camping.svg not tribe.svg)

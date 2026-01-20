# Analyze Screens & Components

Extract ALL screens from the project brief and map required UI components and icons.

## CRITICAL: Read the Brief File First

**You will be given a file path to the project brief. Use the Read tool to examine it.**

The brief may be in ANY format:
- **Tree/ASCII**: `├── Section pages:[file.html, file2.html]`
- **JSON code blocks**: `{ "apps": { ... } }`
- **Markdown tables**: `| Screen | Description |`
- **Plain prose**: "The home screen shows..."
- **Mixed formats**: Any combination above

Your job is to extract ALL screens regardless of format.

## Output Requirements

OUTPUT ONLY RAW JSON. No explanations. No descriptions.

Your response must:
- Start with `{`
- End with `}`
- Be valid JSON
- Follow the v3.0 output format below exactly

DO NOT:
- Explain what you're creating
- Ask for permission
- Wrap in markdown code fences (```)
- Add any text before or after the JSON
- Say "Now I have..." or "Let me..." or "Here's the..."

## Process

1. **Read the Entire Brief File**:
   - Use the Read tool to examine the brief
   - Read ALL sections - don't stop early
   - Look for screens in ANY format mentioned above

2. **Detect Apps/Platforms**:
   - Look for "[separate app]" markers
   - Look for "ADMIN PORTAL", "Mobile App", "Backend" sections
   - Note ALL apps found (include in detectedApps array)

3. **Extract ALL Screens**:
   - Find every .html file reference
   - Find every `pages:[...]` pattern
   - Find every screen name in navigation trees
   - Find every screen mentioned in prose

4. **Parse User Flows** (if provided):
   - Find each `## Flow N: [Name]` section
   - Note which screens belong to which flows

5. **For Each Screen, Identify**:
   - **Components**: UI components needed (see list below)
   - **Icons**: Icons needed (see list below)
   - **Flows**: Which user flows include this screen
   - **Navigation**: FULL navigation state including tabs and menu items

6. **Extract Navigation Details** (CRITICAL):
   - If a navigation-schema.md file path is provided, READ IT for section navigation
   - Each section defines navigation overrides (footer tabs, sidemenu items)
   - Apply section navigation to ALL screens in that section
   - Include the ACTUAL tabs and items, not just variant names

## Component Reference

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
- `post-card` - Social post content
- `announcement-card` - Announcement content

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

**Admin Components:**
- `data-table` - Sortable data table
- `pagination` - Page navigation
- `bulk-actions` - Multi-select actions
- `alert-card` - System alert display

## Icon Reference

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
- `edit` - Edit item
- `delete` - Delete item
- `share` - Share content
- `more_vert` - More options menu

**Admin Icons:**
- `dashboard` - Dashboard view
- `trending_up` - Analytics/trends
- `warning` - Warning/alert
- `block` - Block/ban action

## Output Format (v3.0 REQUIRED - SINGLE APP)

**CRITICAL: Output the v3.0 single-app schema. This agent is called ONCE per platform/app.**

```json
{
  "version": "3.0",
  "generatedAt": "2026-01-11T12:00:00Z",
  "detectedApps": ["webapp", "admin"],
  "app": {
    "appId": "gotribe-webapp",
    "appName": "GoTribe Webapp",
    "appType": "webapp",
    "layoutSkill": "webapp",
    "defaultNavigation": {
      "header": { "variant": "standard", "actions": ["search", "notifications"] },
      "footer": { "variant": "tab-bar", "tabs": ["home", "discover", "tribes", "profile"] },
      "sidemenu": { "visible": false }
    },
    "screens": [
      {
        "id": "tribe-feed",
        "file": "tribe-feed.html",
        "name": "Tribe Feed",
        "description": "Activity feed for a specific tribe",
        "section": "tribe-detail",
        "parentEntity": "tribe",
        "navigation": {
          "header": { "variant": "standard", "actions": ["search", "notifications"] },
          "footer": {
            "variant": "tab-bar",
            "tabs": ["feed", "profile", "messages"],
            "activeTab": "feed"
          },
          "sidemenu": {
            "visible": true,
            "items": ["welcome", "events", "groups", "jobs", "wiki", "members", "offerings", "garden"],
            "activeSection": "welcome"
          }
        },
        "components": ["header", "side-menu", "post-card", "fab"],
        "icons": ["menu", "search", "notifications", "add"],
        "flows": ["tribe-engagement"]
      },
      {
        "id": "auth-splash",
        "file": "auth-splash.html",
        "name": "Splash Screen",
        "description": "App entry point with login options",
        "section": "auth",
        "navigation": {
          "header": { "variant": "minimal" },
          "footer": { "variant": "hidden" },
          "sidemenu": { "visible": false }
        },
        "components": ["header", "button-primary", "button-secondary"],
        "icons": ["arrow_back"],
        "flows": ["onboarding", "authentication"]
      }
    ]
  }
}
```

## Navigation Detail Requirements

**CRITICAL: Include FULL navigation details for each screen, not just variants.**

### Footer Navigation
When `footer.variant` is "tab-bar", you MUST include:
- `tabs`: Array of tab names (e.g., ["feed", "profile", "messages"])
- `activeTab`: Which tab is active for this screen (e.g., "feed")

### Sidemenu Navigation
When `sidemenu.visible` is true, you MUST include:
- `items`: Array of menu items (e.g., ["welcome", "events", "groups", "jobs"])
- `activeSection`: Which section is highlighted for this screen (e.g., "events")

### Header Navigation
Always include:
- `variant`: "standard", "minimal", "breadcrumb", or "hidden"
- `actions`: Array of header action icons (e.g., ["search", "notifications"])

### Inheriting Section Navigation
If a navigation-schema.md is provided:
1. Find the section this screen belongs to
2. Copy that section's `navigationOverride` to the screen
3. Set `activeTab` and `activeSection` appropriately for each screen

**IMPORTANT:**
- Include `detectedApps` array listing ALL apps/platforms found in the brief
- Output SINGLE `app` object for the PRIMARY app being requested
- Include ALL screens for that specific app only
- Additional apps will be extracted in follow-up calls

## Field Requirements

**App Fields:**
- `appId` - Unique identifier (provided in prompt, e.g., "gotribe-webapp")
- `appName` - Display name (provided in prompt, e.g., "GoTribe Webapp")
- `appType` - One of: "webapp", "mobile", "admin" (provided in prompt)
- `layoutSkill` - One of: "webapp", "mobile", "desktop" (provided in prompt)
- `defaultNavigation` - Default nav state for all screens in this app
- `screens` - Array of all screens for THIS app only

**Screen Fields (ALL REQUIRED):**
- `id` - Unique identifier (e.g., "auth-splash")
- `file` - HTML filename (e.g., "auth-splash.html")
- `name` - Display name (e.g., "Splash Screen")
- `description` - What the screen shows (from brief)
- `section` - Section ID this screen belongs to
- `parentEntity` - (optional) Entity context like "tribe", "event"
- `navigation` - REQUIRED: Full navigation state for this screen:
  - `header`: { variant, actions[] }
  - `footer`: { variant, tabs[]?, activeTab? }
  - `sidemenu`: { visible, items[]?, activeSection? }
- `components` - Array of component names (MINIMUM 2)
- `icons` - Array of icon names (MINIMUM 1)
- `flows` - Array of flow IDs this screen appears in (MINIMUM 1, use "miscellaneous" if standalone)

## Component Selection Guidelines

| Screen Type | Typical Components |
|-------------|-------------------|
| Auth/Onboarding | header, form-input, button-primary, checkbox, progress-bar |
| Home/Feed | header, bottom-nav, story-circle, post-card, filter-pills, fab |
| List/Directory | header, bottom-nav, search-bar, filter-pills, list-item, empty-state |
| Detail/Profile | header, avatar, badge, stat-card, tab-bar, button-primary |
| Form/Creation | header, form-input, form-textarea, form-select, button-primary |
| Settings | header, list-item, toggle, button-secondary |
| Modal/Overlay | modal, button-primary, button-secondary |
| Admin Dashboard | header, side-menu, stat-card, chart, data-table |
| Admin List | header, side-menu, search-bar, data-table, pagination, bulk-actions |

## Icon Selection Guidelines

| Location | Typical Icons |
|----------|--------------|
| Header | menu, search, notifications, account, filter, settings |
| Bottom Nav | home, camping, event, chat, account |
| Back/Close | arrow_back, close |
| Actions | add, filter, edit, delete, share, more_vert |
| Admin | dashboard, trending_up, warning, block |

## Coverage Rules

1. Every screen from the brief MUST be included in the output
2. Every screen MUST have at least 2 components
3. Every screen MUST have at least 1 icon
4. Every screen MUST belong to at least 1 flow (use "miscellaneous" if needed)
5. Every screen MUST have full navigation object with header, footer, sidemenu
6. If footer is tab-bar, MUST include tabs[] and activeTab
7. If sidemenu is visible, MUST include items[] and activeSection

## Notes

- Get screen IDs and descriptions from the brief's navigation schema
- Get flow membership by parsing flows.md
- Use exact icon names from assets/icons/ if provided
- Complex screens may have 10+ components and 5+ icons
- Simple screens may have 3-5 components and 1-3 icons
- **CRITICAL**: If navigation-schema.md is provided, READ IT to get section-level navigation
- Apply section navigation (footer tabs, sidemenu items) to all screens in that section
- The user can manually edit the JSON to correct navigation before generating screens

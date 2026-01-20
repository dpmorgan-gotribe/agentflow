# Analyze Flows

Map user journeys informed by research and best practices.

## Output Requirements

OUTPUT ONLY RAW MARKDOWN. No explanations. No descriptions.

Your response must:
- Start with: `# Flow Analysis`
- Be valid Markdown content
- Follow the output format below exactly

DO NOT:
- Explain what you're creating
- Ask for permission
- Wrap in markdown code fences (```)
- Add any text before or after the markdown
- Say "Now I have..." or "Let me..." or "Here's the..."

## Critical Requirements

**OUTPUT FORMAT IS STRICT:**
- Each flow MUST use `## Flow N: [Flow Name]` format (H2 header with ##)
- Do NOT use ### (H3) for flow headers
- Do NOT include style analysis, colors, or typography
- Focus ONLY on user journeys and screen sequences

## Screen Naming Convention

**CRITICAL: Screens that belong to a parent entity MUST include the parent prefix.**

This prevents screen disconnection from parent context:
- `tribe-documents.html` NOT `documents.html`
- `tribe-media.html` NOT `media.html`
- `tribe-members.html` NOT `members.html`
- `event-calendar.html` NOT `calendar.html`
- `user-settings.html` NOT `settings.html`
- `admin-dashboard.html` NOT `dashboard.html`

When a screen is accessed within an entity context (e.g., viewing documents for a specific tribe), the screen name MUST include the entity prefix.

## Coverage Requirement

**CRITICAL: Every screen defined in the brief MUST appear in at least one flow.**

If a "Screen List for Coverage Validation" section is provided in the input:
1. Parse the complete screen list (ALL screens from ALL apps)
2. Track which screens you include in your flows
3. After defining primary flows, check for orphaned screens
4. Create additional flows to achieve 100% coverage:

### Additional Flows for Orphaned Screens
- **"Settings & Profile Flow"** - for settings-*, profile-*, account-*, privacy-* screens
- **"Financial Management Flow"** - for wallet-*, transaction-*, payment-*, subscription-* screens
- **"Tribe Administration Flow"** - for tribe-admin-*, treasury-*, tribe-settings-* screens
- **"Content Management Flow"** - for wiki-*, document-*, media-*, file-* screens
- **"Admin Operations Flow"** - for admin-* screens (admin portal)
- **"Compliance Flow"** - for terms-*, privacy-policy-*, kyc-*, verification-* screens
- **"Notifications Flow"** - for notification-* screens
- **"Miscellaneous Flow"** - for any remaining orphaned screens

### Coverage Validation
At the end of your output, include a coverage summary:
```markdown
## Coverage Summary
- Total screens in brief: [N]
- Screens covered by flows: [N]
- Coverage: 100%
```

**Your output MUST achieve 100% coverage of the screen list.**

## Inputs
- Project brief (entities, features, requirements)
- Wireframes (visible screens, navigation)
- Competitive research (competitor flows, UX patterns)

## Process

1. **Extract from Brief**:
   - Identify key entities (Users, Posts, Events, etc.)
   - Identify features mentioned
   - Understand user goals

2. **Map from Wireframes**:
   - Document visible screens
   - Map navigation patterns (tabs, drawers, modals)
   - Identify screen sequences

3. **Enhance from Research**:
   - What flows do successful competitors use?
   - What onboarding patterns work in this category?
   - What are industry-standard user journeys?

4. **Suggest Improvements**:
   - Flows that competitors have but wireframes don't
   - Best practices not yet implemented

## Output Format

```markdown
# Flow Analysis

## Key Entities
(From brief: main objects/concepts in the system)

| Entity | Description | Relationships |
|--------|-------------|---------------|
| [Entity] | [What it is] | [Related to...] |

## Research-Informed Insights
- [Insight from competitor analysis]
- [Best practice that should be applied]
- [UX pattern recommendation]

---

## Flow 1: Onboarding
**Purpose**: Get new users set up and engaged
**Competitor Reference**: [Which competitor does this well]

**Screens**:
1. [Welcome] → 2. [Sign Up] → 3. [Profile Setup] → 4. [Home]

**Details**:
| Step | Screen | User Action | System Response |
|------|--------|-------------|-----------------|
| 1 | Welcome | Views intro | Shows value prop |
| 2 | Sign Up | Enters email/password | Creates account |
| 3 | Profile Setup | Adds info | Saves preferences |
| 4 | Home | Explores | Shows personalized content |

**Best Practices Applied**:
- [Practice]: [How applied]

---

## Flow 2: [Core Action Name]
**Purpose**: [What user accomplishes]
**Competitor Reference**: [Who does this well]

**Screens**:
1. [Screen A] → 2. [Screen B] → 3. [Screen C]

**Details**:
| Step | Screen | User Action | System Response |
|------|--------|-------------|-----------------|
| ... | ... | ... | ... |

---

## Flow N: [Name]
...

---

## Suggested Flow: [Flow Name]
**Rationale**: [Why this would help]
**Competitor Reference**: [Who does this]
**Proposed Screens**: [Screen sequence]

---

## Navigation Schema

```yaml
# navigation-schema
apps:
  - appId: webapp
    appName: "Web Application"
    appType: webapp
    layoutSkill: webapp
    defaultNavigation:
      header: { variant: standard, actions: [search, notifications, profile] }
      footer: { variant: tab-bar, tabs: [home, discover, tribes, events, profile] }
    sections:
      - sectionId: auth
        sectionName: "Authentication"
        navigationOverride:
          header: { variant: minimal }
          footer: { variant: hidden }
        screens: [login, signup, forgot-password, verify-email]
      - sectionId: tribe
        sectionName: "Tribe Section"
        parentEntity: tribe
        navigationOverride:
          sidemenu: { visible: true, items: [wiki, documents, media, members, settings] }
        screens: [tribe-detail, tribe-wiki, tribe-documents, tribe-media, tribe-members]
      - sectionId: main
        sectionName: "Main Navigation"
        screens: [home, discover, search-results, profile]
  - appId: backend
    appName: "Admin Portal"
    appType: admin
    layoutSkill: desktop
    defaultNavigation:
      sidemenu: { visible: true, items: [dashboard, users, tribes, reports, settings] }
      header: { variant: minimal, actions: [search, admin-profile] }
      footer: { variant: hidden }
    sections:
      - sectionId: dashboard
        screens: [admin-dashboard, admin-metrics]
      - sectionId: user-management
        screens: [admin-users, admin-user-detail]
```
```

## Navigation Schema Guidelines

At the END of your output, add a navigation schema in YAML format.

**For each app (webapp, mobile, backend):**
1. Define default navigation state (sidemenu, header, footer)
2. Group screens into sections based on navigation context
3. Specify navigation overrides per section
4. Include parent entity for contextual screens

**Section examples:**
- `auth` section: minimal header, hidden footer (login, signup, etc.)
- `tribe` section: sidemenu visible with tribe sub-navigation
- `main` section: standard header/footer for primary screens
- `dashboard` section: admin sidebar always visible

This schema enables downstream navigation validation and userflows visualization.

## Notes

- Extract entity names from brief (e.g., "Tribes", "Events", "Users")
- Map how entities appear in wireframe screens
- Document navigation patterns (tabs, drawers, modals)
- Include both existing flows (from wireframes) and suggested flows (from research)

## Output Reminder

Your output MUST:
1. Start with `# Flow Analysis`
2. Use `## Flow N: [Name]` format for each flow (H2 level with ##, NOT ###)
3. Include only flow/journey content - NO style information, colors, or typography

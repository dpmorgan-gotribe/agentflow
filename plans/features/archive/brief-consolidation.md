# Brief Consolidation Plan

## Problem Statement

The GoTribe project has 3 separate brief files:
- `brief.md` (2,386 lines) - Main project specification
- `brief-webapp.md` (606 lines) - Frontend screen inventory (~210 screens)
- `brief-backend.md` (671 lines) - Backend admin screen inventory (~221 screens)
- `brief-mobile.md` - Does NOT exist (mobile is part of webapp)

This separation causes problems:
1. **Screen disconnection** - Screens like "documents" and "media" lose parent entity context
2. **No structured navigation** - Navigation states (sidemenu, header, footer) not explicitly defined per screen
3. **Multi-app confusion** - The analyst doesn't understand which screens belong to which app

## Objective

Create a consolidated `brief-gotribe.md` that:
1. Preserves all valuable information from existing briefs
2. Identifies all application targets (webapp, mobile, backend portal)
3. Uses a **structured JSON navigation schema** that prevents screen/navigation ambiguity

---

## Proposed Structure for brief-gotribe.md

```markdown
# GoTribe Project Brief

## 1. Vision & Principles
[From brief.md - core philosophy, problem statement]

## 2. Core Entities & Visibility
[From brief.md - entity definitions, visibility model]

## 3. User Personas & Roles
[From brief.md - 5 user personas]
[From brief-backend.md - 9 admin roles]

## 4. Navigation Architecture
[From brief.md - global patterns]
[NEW: Explicit per-app navigation defaults]

## 5. Applications

### 5.1 GoTribe Webapp (Frontend)
[Structured JSON schema with sections, screens, navigation states]

### 5.2 GoTribe Mobile (Native App)
[Structured JSON schema - subset of webapp with mobile-specific navigation]

### 5.3 GoTribe Admin Portal (Backend)
[Structured JSON schema with admin sections, screens, navigation states]

## 6. Features Specification
[From brief.md - all 12 key features with cross-app screen references]

## 7. Financial System
[From brief.md - treasury, dues, marketplace]

## 8. Analytics & ML
[From brief.md - data models, ML models, metrics]

## 9. Design System
[From brief.md - colors, typography, UI patterns]

## 10. MVP Scope
[From brief-webapp.md and brief-backend.md - phased rollout]
```

---

## JSON Navigation Schema Format

Each app will have a structured navigation schema:

```json
{
  "apps": {
    "gotribe-webapp": {
      "appType": "webapp",
      "layoutSkill": "webapp",
      "defaultNavigation": {
        "header": {
          "variant": "standard",
          "logo": true,
          "actions": ["search", "notifications", "messages", "settings"]
        },
        "footer": {
          "variant": "tab-bar",
          "tabs": ["home", "reels", "create", "discover", "profile"]
        },
        "sidemenu": {
          "visible": false
        }
      },
      "sections": {
        "auth": {
          "sectionName": "Authentication",
          "navigationOverride": {
            "header": { "variant": "minimal" },
            "footer": { "variant": "hidden" }
          },
          "screens": [
            {
              "id": "splash",
              "file": "splash.html",
              "description": "App intro with logo and tagline"
            },
            {
              "id": "signin",
              "file": "signin.html",
              "description": "Email/password sign in form"
            }
          ]
        },
        "discovery": {
          "sectionName": "Discovery",
          "screens": [
            {
              "id": "home-feed",
              "file": "home-feed.html",
              "description": "Personalized activity feed from followed tribes/events"
            },
            {
              "id": "discover",
              "file": "discover.html",
              "description": "Browse tribes, events, retreats with swipe/list/map views"
            }
          ]
        },
        "tribe": {
          "sectionName": "Tribe Context",
          "parentEntity": "tribe",
          "navigationOverride": {
            "sidemenu": {
              "visible": true,
              "items": ["feed", "wiki", "documents", "media", "members", "events", "jobs", "offerings", "shop", "governance", "settings"]
            }
          },
          "screens": [
            {
              "id": "tribe-detail",
              "file": "tribe-detail.html",
              "description": "Tribe public profile with about, stats, join button"
            },
            {
              "id": "tribe-feed",
              "file": "tribe-feed.html",
              "description": "Activity feed within tribe context"
            },
            {
              "id": "tribe-documents",
              "file": "tribe-documents.html",
              "description": "Document library for tribe with upload, search, folders",
              "sidemenuActive": "documents"
            },
            {
              "id": "tribe-media",
              "file": "tribe-media.html",
              "description": "Media gallery for tribe photos and videos",
              "sidemenuActive": "media"
            }
          ]
        },
        "event": {
          "sectionName": "Event Context",
          "parentEntity": "event",
          "navigationOverride": {
            "sidemenu": {
              "visible": true,
              "items": ["details", "gallery", "attendees", "schedule", "check-in"]
            }
          },
          "screens": [...]
        }
      }
    },
    "gotribe-admin": {
      "appType": "admin",
      "layoutSkill": "desktop",
      "defaultNavigation": {
        "header": {
          "variant": "minimal",
          "actions": ["search", "notifications", "admin-profile"]
        },
        "footer": {
          "variant": "hidden"
        },
        "sidemenu": {
          "visible": true,
          "items": ["dashboard", "users", "tribes", "events", "marketplace", "moderation", "finance", "compliance", "analytics", "ml-ops", "infrastructure", "settings"]
        }
      },
      "sections": {
        "dashboard": {
          "sectionName": "Main Dashboard",
          "screens": [
            {
              "id": "admin-dashboard",
              "file": "admin-dashboard.html",
              "description": "Platform metrics overview: active users, tribe activity, revenue, flagged content"
            }
          ]
        },
        "users": {
          "sectionName": "User Management",
          "sidemenuActive": "users",
          "screens": [
            {
              "id": "admin-users-list",
              "file": "admin-users-list.html",
              "description": "Searchable, filterable list of all platform users"
            },
            {
              "id": "admin-user-detail",
              "file": "admin-user-detail.html",
              "description": "User profile with activity, memberships, financial, content tabs"
            }
          ]
        }
      }
    }
  }
}
```

---

## Implementation Steps

### Step 1: Create Brief Structure Template
Create the markdown structure with placeholders for each section.

### Step 2: Extract Core Content
Copy from brief.md:
- Vision & Principles
- Core Entities
- User Personas
- Navigation Architecture base
- Feature Specifications
- Financial System
- Analytics & ML
- Design System

### Step 3: Build Webapp Navigation Schema
Convert brief-webapp.md screen inventory into structured JSON:
- Group screens by navigation context (auth, discovery, tribe, event, etc.)
- Define section-level navigation overrides
- Add parent entity references where applicable
- Include screen descriptions

### Step 4: Build Admin Navigation Schema
Convert brief-backend.md screen inventory into structured JSON:
- Group screens by admin function
- Define consistent sidemenu structure
- Include role-based access hints

### Step 5: Define Mobile Schema
Create mobile-specific subset:
- Identify which webapp screens apply to mobile
- Define mobile-specific navigation (touch-optimized tabs, gestures)
- Note screens that are web-only

### Step 6: Add Cross-References
Link related screens across apps:
- Webapp tribe detail ↔ Admin tribe management
- Webapp user profile ↔ Admin user detail
- Webapp application submit ↔ Admin application review

### Step 7: Validate Coverage
Ensure every screen from brief-webapp.md and brief-backend.md appears in the consolidated brief with proper navigation context.

---

## Files to Create

1. **`projects/gotribe/brief-gotribe.md`** - Consolidated brief with JSON navigation schema
2. Keep existing files as backups:
   - `projects/gotribe/brief.md` → `projects/gotribe/archive/brief-original.md`
   - `projects/gotribe/brief-webapp.md` → `projects/gotribe/archive/brief-webapp-original.md`
   - `projects/gotribe/brief-backend.md` → `projects/gotribe/archive/brief-backend-original.md`

---

## Key Benefits

1. **Single source of truth** - One file defines all apps and screens
2. **Explicit navigation states** - No ambiguity about sidemenu/header/footer per screen
3. **Parent entity context** - Screens like `tribe-documents` clearly belong to tribe section
4. **Multi-app awareness** - Analyst can parse apps and generate appropriate layouts
5. **Coverage validation** - Structured format enables 100% coverage checking
6. **Downstream compatibility** - JSON schema feeds directly into enhanced screens.json

---

## Verification

After consolidation:
1. Run `agentflow analyze` on the gotribe project
2. Verify navigation-schema.md is generated correctly
3. Verify screens.json has v2.0 format with apps/sections
4. Run `agentflow userflows` to generate visualization
5. Check all ~431 screens are accounted for (210 webapp + 221 admin)

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
```

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

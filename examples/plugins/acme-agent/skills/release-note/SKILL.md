---
name: release-note
description: Write a release note entry for the change on this task. Use when the person asks for a release note or a changelog line.
---

# Write a release note

1. Read the task's Acme notes with the `acme-agent_list_notes` tool, and the diff of the change.
2. Write one entry, in the past tense, that says what changed for the person using the product. Leave
   out how the code changed.
3. Start the entry with **Added**, **Changed**, or **Fixed**.
4. Save the entry with the `acme-agent_add_note` tool, so the person finds it on the task.

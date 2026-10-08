export function noProjectsScreenVisible(input: { projectCount: number | undefined; projectsError: boolean; wizardVisible: boolean }): boolean {
  return input.projectCount === 0 && !input.projectsError && !input.wizardVisible
}

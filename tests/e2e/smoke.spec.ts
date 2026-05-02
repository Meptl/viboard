import { expect, test } from '@playwright/test';

async function acceptDisclaimerIfVisible(page: import('@playwright/test').Page) {
  const acceptButton = page.getByRole('button', {
    name: 'I Understand, Continue',
  });

  if (await acceptButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await acceptButton.click();
  }
}

test('projects page and settings are reachable', async ({ page }) => {
  await page.goto('/projects');
  await acceptDisclaimerIfVisible(page);

  await expect(
    page.getByRole('heading', { name: 'Projects', exact: true })
  ).toBeVisible();

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings\/general|\/settings\/projects/);
});

test('project list supports clicking into task page when projects exist', async ({
  page,
}) => {
  await page.goto('/projects');
  await acceptDisclaimerIfVisible(page);

  const failedToFetchProjects = page.getByText('Failed to fetch projects');
  if (
    await failedToFetchProjects.isVisible({ timeout: 2_000 }).catch(() => false)
  ) {
    test.skip(true, 'Backend is unavailable or project list failed to load.');
  }

  const noProjectsMessage = page.getByText('No projects yet');
  if (await noProjectsMessage.isVisible({ timeout: 2_000 }).catch(() => false)) {
    test.skip(true, 'No projects exist in local seed data.');
  }

  const firstProjectCard = page.locator('div.cursor-pointer').first();
  await firstProjectCard.click();

  await expect(page).toHaveURL(/\/projects\/[^/]+\/tasks/);
});

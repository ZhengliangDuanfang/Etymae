import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

type SeedEntryIds = {
  proto: number;
  mater: number;
  mere: number;
  mother: number;
  orphan: number;
};

const seedIds: SeedEntryIds = {
  proto: 1,
  mater: 2,
  mere: 3,
  mother: 4,
  orphan: 5,
};

function cardById(page: Page, id: number) {
  return page.getByTestId(`entry-card-${id}`);
}

async function resetTestData(request: APIRequestContext) {
  const response = await request.post('http://127.0.0.1:20263/api/test/reset');
  expect(response.ok()).toBeTruthy();
}

async function openCardFromSearch(page: Page, query: string, resultId: number) {
  const search = page.getByLabel('Search entries');
  await search.fill(query);
  await expect(page.getByTestId(`search-result-${resultId}`)).toBeVisible();
  await page.getByTestId(`search-result-${resultId}`).click();
}

test.beforeEach(async ({ page, request }) => {
  await resetTestData(request);
  await page.goto('/');
});

test('supports search and opening upstream linked cards', async ({ page }) => {
  await openCardFromSearch(page, 'mother', seedIds.mother);

  const motherCard = cardById(page, seedIds.mother);
  await expect(motherCard).toBeVisible();
  await expect(motherCard.getByRole('heading', { name: 'mother' })).toBeVisible();
  await expect(motherCard.getByText('the female parent')).toBeVisible();
  await expect(motherCard.getByRole('button', { name: 'mere' })).toBeVisible();

  await motherCard.getByRole('button', { name: 'mere' }).click();

  const mereCard = cardById(page, seedIds.mere);
  await expect(mereCard).toBeVisible();
  await expect(mereCard.getByRole('heading', { name: 'mere' })).toBeVisible();
  await expect(page.getByLabel('Search entries')).toHaveValue('');
});

test('creates a new card with resolved and unresolved upstream links', async ({ page }) => {
  await page.getByRole('button', { name: '新增卡片' }).click();
  const modal = page.locator('.modal-card');
  const saveButton = modal.getByRole('button', { name: '保存' });

  await expect(saveButton).toBeDisabled();
  await expect(modal).toBeVisible();

  await page.getByLabel('拼写').fill('daughter');
  await page.getByLabel('语言归属').fill('English');
  await page.getByLabel('含义描述').fill('child linked to mother');
  await page.getByLabel('别名').fill('girl child');
  await page.getByLabel('上游关联').fill('mother [English], phantom [PIE]');
  await saveButton.click();

  const daughterCard = page.locator('[data-testid^="entry-card-"]').filter({
    has: page.getByRole('heading', { name: 'daughter' }),
  });
  await expect(daughterCard).toBeVisible();
  await expect(daughterCard.getByText('child linked to mother')).toBeVisible();
  await expect(daughterCard.getByRole('button', { name: 'mother' })).toBeVisible();
  await expect(daughterCard.getByText('phantom [PIE]')).toBeVisible();
});

test('edits an existing card and allows hiding it from the board', async ({ page }) => {
  await openCardFromSearch(page, 'mother', seedIds.mother);

  const motherCard = cardById(page, seedIds.mother);
  await motherCard.getByLabel('修改卡片').click();
  await page.getByLabel('含义描述').fill('updated meaning for tests');
  await page.getByLabel('上游关联').fill('mater [Latin], missing-link [Proto]');
  await page.getByRole('button', { name: '保存' }).click();

  await expect(motherCard.getByText('updated meaning for tests')).toBeVisible();
  await expect(motherCard.getByRole('button', { name: 'mater' })).toBeVisible();
  const unresolvedUpstream = motherCard.getByTestId('unresolved-upstream-4-missing-link [Proto]');
  await expect(unresolvedUpstream).toBeVisible();
  await expect(motherCard.getByRole('button', { name: 'missing-link [Proto]' })).toHaveCount(0);

  await motherCard.getByLabel('隐藏卡片').click();
  await expect(motherCard).toHaveCount(0);

  await openCardFromSearch(page, 'mother', seedIds.mother);
  await expect(cardById(page, seedIds.mother)).toBeVisible();
});

test('deletes a card and keeps dependent links as unresolved labels', async ({ page }) => {
  await openCardFromSearch(page, 'mother', seedIds.mother);
  await openCardFromSearch(page, 'mere', seedIds.mere);

  const mereCard = cardById(page, seedIds.mere);
  await mereCard.getByLabel('删除卡片').click();
  const confirmCard = page.locator('.confirm-card');
  await confirmCard.getByRole('button', { name: '删除', exact: true }).click();

  await expect(mereCard).toHaveCount(0);

  const motherCard = cardById(page, seedIds.mother);
  await expect(motherCard).toBeVisible();
  await expect(motherCard.getByText('mere [French]')).toBeVisible();
});

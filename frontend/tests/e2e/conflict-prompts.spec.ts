import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

type EntryPayload = {
  spelling: string;
  language: string;
  meaning: string;
  aliases_raw: string;
  upstream_raw: string;
};

const backendBaseUrl = 'http://127.0.0.1:20263';

function cardById(page: Page, id: number) {
  return page.getByTestId(`entry-card-${id}`);
}

async function resetTestData(request: APIRequestContext) {
  const response = await request.post(`${backendBaseUrl}/api/test/reset`);
  expect(response.ok()).toBeTruthy();
}

async function createEntry(request: APIRequestContext, payload: EntryPayload) {
  const response = await request.post(`${backendBaseUrl}/api/entries`, { data: payload });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { id: number; spelling: string };
}

async function openCardFromSearch(page: Page, query: string, resultId: number) {
  const search = page.getByLabel('Search entries');
  await search.fill(query);
  await expect(page.getByTestId(`search-result-${resultId}`)).toBeVisible();
  await page.getByTestId(`search-result-${resultId}`).click();
}

async function fillEntryForm(scope: Locator, payload: EntryPayload) {
  await scope.getByLabel('拼写').fill(payload.spelling);
  await scope.getByLabel('语言归属').fill(payload.language);
  await scope.getByLabel('含义描述').fill(payload.meaning);
  await scope.getByLabel('别名').fill(payload.aliases_raw);
  await scope.getByLabel('上游关联').fill(payload.upstream_raw);
}

async function expectCreateConflict(page: Page, payload: EntryPayload, expectedMessage: string) {
  await page.getByRole('button', { name: '新增卡片' }).click();
  const modal = page.locator('.modal-card');
  await fillEntryForm(modal, payload);
  await modal.getByRole('button', { name: '保存' }).click();
  await expect(modal.getByText(expectedMessage)).toBeVisible();
  await expect(modal.getByRole('heading', { name: '新增卡片' })).toBeVisible();
}

async function expectEditConflict(
  page: Page,
  query: string,
  resultId: number,
  payload: EntryPayload,
  expectedMessage: string,
) {
  await openCardFromSearch(page, query, resultId);
  const entryCard = cardById(page, resultId);
  await entryCard.getByLabel('修改卡片').click();

  const modal = page.locator('.modal-card');
  await fillEntryForm(modal, payload);
  await modal.getByRole('button', { name: '保存' }).click();

  await expect(modal.getByText(expectedMessage)).toBeVisible();
  await expect(modal.getByRole('heading', { name: '修改卡片' })).toBeVisible();
}

async function expectCreateSuccess(page: Page, payload: EntryPayload, headingName: string) {
  await page.getByRole('button', { name: '新增卡片' }).click();
  const modal = page.locator('.modal-card');
  await fillEntryForm(modal, payload);
  await modal.getByRole('button', { name: '保存' }).click();

  await expect(modal).toHaveCount(0);
  const createdCard = page.locator('[data-testid^="entry-card-"]').filter({
    has: page.getByRole('heading', { name: headingName }),
  });
  await expect(createdCard).toBeVisible();
  return createdCard;
}

async function expectEditSuccess(page: Page, query: string, resultId: number, payload: EntryPayload) {
  await openCardFromSearch(page, query, resultId);
  const entryCard = cardById(page, resultId);
  await entryCard.getByLabel('修改卡片').click();

  const modal = page.locator('.modal-card');
  await fillEntryForm(modal, payload);
  await modal.getByRole('button', { name: '保存' }).click();

  await expect(modal).toHaveCount(0);
  return entryCard;
}

test.beforeEach(async ({ page, request }) => {
  await resetTestData(request);
  await page.goto('/');
});

test('shows a prompt when creating a card with internal alias conflicts', async ({ page }) => {
  await expectCreateConflict(
    page,
    {
      spelling: 'seabird',
      language: 'English',
      meaning: 'self alias conflict case',
      aliases_raw: 'sea-bird, sea bird',
      upstream_raw: '',
    },
    '当前词条内存在冲突：别名“sea bird”与别名“sea-bird”在语言归属“English”下重复。',
  );
});

test('does not show a prompt when creating a card whose alias only overlaps across languages', async ({ page }) => {
  const createdCard = await expectCreateSuccess(
    page,
    {
      spelling: 'caretaker',
      language: 'English',
      meaning: 'cross-language alias overlap remains allowed',
      aliases_raw: 'mere',
      upstream_raw: '',
    },
    'caretaker',
  );
  await expect(createdCard).toBeVisible();
  await expect(createdCard.getByText('cross-language alias overlap remains allowed')).toBeVisible();
});

test('shows prompts when creating a card whose upstream overlaps itself or across languages without a language tag', async ({ page, request }) => {
  await test.step('upstream overlaps with the current entry alias in the same language', async () => {
    await expectCreateConflict(
      page,
      {
        spelling: 'caretaker',
        language: 'English',
        meaning: 'self upstream overlap case',
        aliases_raw: 'guardian',
        upstream_raw: 'guardian',
      },
      '上游关联“guardian”与当前词条自身重叠，不能将词条设置为自己的上游。',
    );
  });

  await page.reload();

  await test.step('same-language upstream links with different spellings stay allowed without specifying the language', async () => {
    await createEntry(request, {
      spelling: 'caretaker-shadow',
      language: 'English',
      meaning: 'second English upstream target',
      aliases_raw: '',
      upstream_raw: '',
    });

    const createdCard = await expectCreateSuccess(
      page,
      {
        spelling: 'descendant',
        language: 'English',
        meaning: 'same-language upstream without language tags',
        aliases_raw: '',
        upstream_raw: 'mother, caretaker-shadow',
      },
      'descendant',
    );
    await expect(createdCard.getByRole('button', { name: 'mother' })).toBeVisible();
    await expect(createdCard.getByRole('button', { name: 'caretaker-shadow' })).toBeVisible();
  });

  await page.reload();

  await test.step('upstream labels that resolve to the same entry are rejected', async () => {
    await expectCreateConflict(
      page,
      {
        spelling: 'descendant-dup',
        language: 'English',
        meaning: 'duplicate upstream labels',
        aliases_raw: '',
        upstream_raw: 'mother, mother [English]',
      },
      '当前词条内存在冲突：上游关联“mother [English]”与上游关联“mother”重复，都指向词条“mother [English]”。',
    );
  });

  await page.reload();

  await test.step('upstream matches multiple languages without specifying the language', async () => {
    await createEntry(request, {
      spelling: 'mother',
      language: 'Latin',
      meaning: 'Latin duplicate for upstream ambiguity',
      aliases_raw: '',
      upstream_raw: '',
    });

    await expectCreateConflict(
      page,
      {
        spelling: 'descendant-cross',
        language: 'English',
        meaning: 'cross-language upstream ambiguity',
        aliases_raw: '',
        upstream_raw: 'mother',
      },
      '上游关联“mother”匹配到多个语言归属（English、Latin），无法成功设置；请改用“spelling [语言]”格式。',
    );
  });
});

test('does not show a prompt when editing a card whose alias only overlaps across languages', async ({ page }) => {
  const orphanCard = await expectEditSuccess(page, 'orphan', 5, {
    spelling: 'orphan',
    language: 'English',
    meaning: 'entry with an unresolved upstream',
    aliases_raw: 'mere',
    upstream_raw: 'missing-root [PIE]',
  });
  await expect(orphanCard.getByText('missing-root [PIE]')).toBeVisible();
});

test('shows a prompt when editing a card with internal alias conflicts', async ({ page }) => {
  await expectEditConflict(
    page,
    'orphan',
    5,
    {
      spelling: 'orphan',
      language: 'English',
      meaning: 'entry with an unresolved upstream',
      aliases_raw: 'sea-bird, sea bird',
      upstream_raw: 'missing-root [PIE]',
    },
    '当前词条内存在冲突：别名“sea bird”与别名“sea-bird”在语言归属“English”下重复。',
  );
});

test('shows prompts when editing a card whose upstream overlaps itself or across languages without a language tag', async ({ page, request }) => {
  await test.step('upstream overlaps with the current entry alias in the same language', async () => {
    await expectEditConflict(
      page,
      'orphan',
      5,
      {
        spelling: 'orphan',
        language: 'English',
        meaning: 'entry with an unresolved upstream',
        aliases_raw: 'guardian',
        upstream_raw: 'guardian',
      },
      '上游关联“guardian”与当前词条自身重叠，不能将词条设置为自己的上游。',
    );
  });

  await page.reload();

  await test.step('same-language upstream links with different spellings stay allowed without specifying the language', async () => {
    await createEntry(request, {
      spelling: 'caretaker-shadow',
      language: 'English',
      meaning: 'second English upstream target',
      aliases_raw: '',
      upstream_raw: '',
    });

    const orphanCard = await expectEditSuccess(page, 'orphan', 5, {
      spelling: 'orphan',
      language: 'English',
      meaning: 'entry with an unresolved upstream',
      aliases_raw: '',
      upstream_raw: 'mother, caretaker-shadow',
    });
    await expect(orphanCard.getByRole('button', { name: 'mother' })).toBeVisible();
    await expect(orphanCard.getByRole('button', { name: 'caretaker-shadow' })).toBeVisible();
  });

  await page.reload();

  await test.step('upstream labels that resolve to the same entry are rejected', async () => {
    await expectEditConflict(
      page,
      'orphan',
      5,
      {
        spelling: 'orphan',
        language: 'English',
        meaning: 'entry with an unresolved upstream',
        aliases_raw: '',
        upstream_raw: 'mother, mother [English]',
      },
      '当前词条内存在冲突：上游关联“mother [English]”与上游关联“mother”重复，都指向词条“mother [English]”。',
    );
  });

  await page.reload();

  await test.step('upstream matches multiple languages without specifying the language', async () => {
    await createEntry(request, {
      spelling: 'mother',
      language: 'Latin',
      meaning: 'Latin duplicate for upstream ambiguity',
      aliases_raw: '',
      upstream_raw: '',
    });

    await expectEditConflict(
      page,
      'orphan',
      5,
      {
        spelling: 'orphan',
        language: 'English',
        meaning: 'entry with an unresolved upstream',
        aliases_raw: '',
        upstream_raw: 'mother',
      },
      '上游关联“mother”匹配到多个语言归属（English、Latin），无法成功设置；请改用“spelling [语言]”格式。',
    );
  });
});

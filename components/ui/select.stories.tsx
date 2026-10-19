import type { Meta, StoryObj } from '@storybook/react';
import { Select } from './select';
import type { SelectOption } from './select';

const JURISDICTION_OPTIONS: SelectOption[] = [
  { value: 'KE', label: 'Kenya' },
  { value: 'NG', label: 'Nigeria' },
  { value: 'GH', label: 'Ghana' },
  { value: 'ZA', label: 'South Africa' },
  { value: 'US', label: 'United States' },
  { value: 'EU', label: 'European Union' },
];

const CATEGORY_GROUPS: SelectOption[] = [
  {
    label: 'Industry',
    options: [
      { value: 'technology', label: 'Technology' },
      { value: 'healthcare', label: 'Healthcare' },
      { value: 'logistics', label: 'Logistics' },
    ],
  },
  {
    label: 'Sector',
    options: [
      { value: 'agriculture', label: 'Agriculture' },
      { value: 'construction', label: 'Construction' },
      { value: 'manufacturing', label: 'Manufacturing' },
    ],
  },
];

const meta: Meta<typeof Select> = {
  title: 'UI/Select',
  component: Select,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[320px]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: 'Jurisdiction',
    placeholder: 'Select jurisdiction...',
    options: JURISDICTION_OPTIONS,
  },
};

export const WithValue: Story = {
  args: {
    label: 'Jurisdiction',
    placeholder: 'Select jurisdiction...',
    options: JURISDICTION_OPTIONS,
    value: 'KE',
  },
};

export const Disabled: Story = {
  args: {
    label: 'Jurisdiction',
    placeholder: 'Not available',
    options: JURISDICTION_OPTIONS,
    disabled: true,
  },
};

export const Error: Story = {
  args: {
    label: 'Jurisdiction',
    placeholder: 'Select jurisdiction...',
    options: JURISDICTION_OPTIONS,
    error: 'Please select a valid jurisdiction',
  },
};

export const Searchable: Story = {
  args: {
    label: 'Invoice Category',
    placeholder: 'Search categories...',
    options: JURISDICTION_OPTIONS,
    isSearchable: true,
  },
};

export const MultiSelect: Story = {
  args: {
    label: 'Risk Tiers',
    placeholder: 'Select risk tiers...',
    options: [
      { value: 'AAA', label: 'AAA — Lowest Risk' },
      { value: 'AA', label: 'AA — Very Low Risk' },
      { value: 'A', label: 'A — Low Risk' },
      { value: 'BBB', label: 'BBB — Medium Risk' },
      { value: 'BB', label: 'BB — Higher Risk' },
    ],
    isMulti: true,
    value: ['A', 'BBB'],
  },
};

export const GroupedOptions: Story = {
  args: {
    label: 'Industry Category',
    placeholder: 'Select category...',
    options: CATEGORY_GROUPS,
  },
};

export const Loading: Story = {
  args: {
    label: 'Jurisdiction',
    placeholder: 'Loading jurisdictions...',
    options: [],
    loading: true,
  },
};

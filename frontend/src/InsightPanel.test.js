// frontend/src/InsightPanel.test.js
// Tests for the UI component that switches between Brief and Deep modes

test('renders default Brief mode', () => {
  const { getByText } = render(<InsightPanel />);
  expect(getByText(/Brief Overview/i)).toBeInTheDocument();
  expect(getByText(/Llama 3.1/i)).toBeInTheDocument(); // Model indicator
});

test('toggles to Deep mode', async () => {
  const { getByText, getByRole } = render(<InsightPanel />);
  
  fireEvent.click(getByRole('button', { name: /Deep Dive/i }));
  
  // Expect loading state first (streaming)
  expect(getByText(/Reasoning.../i)).toBeInTheDocument();
  
  // Expect DeepSeek model indicator
  await waitFor(() => expect(getByText(/DeepSeek-R1/i)).toBeInTheDocument());
});

test('displays citations when available', () => {
    // RAG check
    const citations = [{ source: "Q3 Report", url: "doc_123" }];
    const { getByText } = render(<InsightPanel citations={citations} />);
    expect(getByText("Q3 Report")).toBeInTheDocument();
});

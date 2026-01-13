type Props = {
  result: {
    data?: { 
      message?: string;
      serverError?: string;
      validationErrors?: Record<string, string[] | undefined>;
    };
  };
};

const MessageBox = ({
  type,
  content,
}: {
  type: "success" | "error";
  content: React.ReactNode;
}) => (
  <div
    className={`bg-accent px-4 py-2 my-2 rounded-lg ${
      type === "error" ? "text-red-500" : ""
    }`}
  >
    {type === "success" ? "🎉" : "🚨"} {content}
  </div>
);

export function DisplayServerActionResponse({ result }: Props) {
  const { data } = result;

  return (
    <div>
      {data?.message && (
        <MessageBox type="success" content={`Success: ${data.message}`} />
      )}

      {data?.serverError && (
        <MessageBox type="error" content={`Error: ${data.serverError}`} />
      )}

      {data?.validationErrors &&
        Object.entries(data.validationErrors).map(([field, messages]) => (
          <MessageBox
            key={field}
            type="error"
            content={messages?.map((m, idx) => <p key={idx}>{`${field}: ${m}`}</p>)}
          />
        ))}
    </div>
  );
}

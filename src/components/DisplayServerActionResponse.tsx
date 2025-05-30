type Props = {
  result: {
    data?: { 
      message?: string;
      serverError?: string;
      validationErrors?: Record<string, string[] | undefined>;
     };
  };
};
  
// type Props = {
//     result: {
//       data?: { message?: string };
//       serverError?: string;
//       validationErrors?: Record<string, string[] | undefined>;
//     };
//   };

  const MessageBox = ({
    type,
    content,
}: {
    type: 'success' | 'error',
    content: React.ReactNode,
}) => (
    <div className={`bg-accent px-4 py-2 my-2 rounded-lg ${type === 'error' ? 'text-red-500' : ''}`}>
        {type === 'success' ? '🎉' : '🚨'} {content}
    </div>
)
  
export function DisplayServerActionResponse({ result }: Props) {
  const { data } = result
  const validationErrors= result
  return (
    <div>
      {data?.message && (
        <MessageBox type="success" content={`Success: ${data.message}`} />
      )}

      {data?.serverError && (
        <MessageBox type="error" content={`Error: ${data?.serverError}`} />
      )}

      {data?.validationErrors && (
         <MessageBox
         type="error"
         content={Object.keys(data?.validationErrors).map(key => (
             <p key={key}>{`${key}: ${validationErrors[key as keyof typeof validationErrors]}`}</p>
         ))}
      />
      )}
    </div>
  );
}


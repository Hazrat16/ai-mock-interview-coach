/**
 * Sentences for the speech check in Settings, read aloud and saved for `make bench-stt`. Interview-style, with
 * the vocabulary that trips speech recognition: numbers, tools, acronyms, and (from the second half) the
 * technical terms that came out wrong in real interviews ("race condition" → "rest condition", "event loop"
 * → "even look", "B-trees" → "beetries"). `question` is what an interviewer would have asked, so the benchmark
 * can test passing the question to Whisper as a vocabulary hint.
 */
export const SPEECH_CHECK = [
  {
    text: 'In my last project I reduced the API response time from eight hundred milliseconds to about one hundred and twenty.',
    question: 'Tell me about a time you improved performance.',
  },
  {
    text: 'I would store the sessions in Redis and keep the user accounts in PostgreSQL, behind a load balancer.',
    question: 'How would you store user sessions for a web app?',
  },
  {
    text: 'When two teammates disagreed about the deadline, I set up a short meeting and we agreed to ship a smaller first version.',
    question: 'Tell me about a time you resolved a conflict in your team.',
  },
  {
    text: 'A hash map gives constant time lookups on average, but in the worst case it can degrade to linear time.',
    question: 'How does a hash map work, and what is its time complexity?',
  },
  {
    text: 'I enjoy working with Docker and Kubernetes, and I have written CI pipelines that run the tests on every pull request.',
    question: 'What tools do you use to build and deploy your services?',
  },
  {
    text: 'A race condition happens when two threads update the same account balance at the same time, so I would use a lock or a database transaction.',
    question: 'What is a race condition? Give an example and explain how to prevent it.',
  },
  {
    text: 'JavaScript is single threaded. The event loop runs the call stack first, then drains the microtask queue, and then takes the next macrotask.',
    question: 'Explain how the JavaScript event loop works.',
  },
  {
    text: 'An index is usually a B-tree, so it turns a full table scan into a logarithmic lookup, but every insert and update has to maintain it.',
    question: 'How does an index speed up a database query, and what does it cost?',
  },
  {
    text: 'REST is stateless and resource oriented, while GraphQL exposes one endpoint and lets the client ask for exactly the fields it needs.',
    question: 'What are REST principles, and when might you choose something else, like GraphQL or gRPC?',
  },
  {
    text: 'I hash passwords with bcrypt, and I keep a short lived JWT access token and a refresh token in an HTTP only cookie.',
    question:
      'What is the difference between authentication and authorization? How would you implement them in a web app?',
  },
  {
    text: 'I choose SQL when the schema is fixed and I need joins, and NoSQL like MongoDB when the shape of the data changes often.',
    question: 'Explain the difference between SQL and NoSQL databases, and how you would choose between them.',
  },
  {
    text: 'Git merge keeps both histories with a merge commit, while git rebase replays my commits on top of main for a linear history.',
    question: 'What is the difference between git merge and git rebase, and when would you use each?',
  },
] as const;

/** The interviewer question a speech check sentence answers, for benchmarking the vocabulary hint. */
export const questionForSentence = (text: string) => SPEECH_CHECK.find((s) => s.text === text)?.question;

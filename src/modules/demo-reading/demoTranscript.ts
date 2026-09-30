const DEMO_TRANSCRIPT_PARAGRAPHS = [
  'Good sleep can improve your mood, focus, and overall health. A steady sleep routine gives your body a clearer rhythm for rest and wakefulness. Rather than chasing a perfect night, begin with a few habits you can repeat, then notice which ones help you feel more alert the next day.',
  'Start by going to bed and waking at about the same time every day, including weekends. A consistent schedule helps regulate your internal clock, which can make it easier to fall asleep and wake naturally. If your routine has drifted, adjust it in small steps instead of trying to change several hours at once.',
  'Seek natural light soon after waking. Morning light tells your brain that the day has begun and helps set the timing for sleep later that night. Open the curtains, sit near a bright window, or take a short walk outdoors. In the evening, lower the light where you can so the contrast between day and night stays clear.',
  'Regular movement can also support sleep, especially when it happens earlier in the day. Choose an activity that fits your energy and schedule, whether that is walking, cycling, stretching, or a short workout. Caffeine can linger longer than expected, so notice how an afternoon coffee affects your sleep and move it earlier if needed.',
  'If you nap, keep it short enough that it does not replace the sleep you need at night. An early-afternoon rest may restore attention without pushing bedtime later. Notice the result the same way you would notice caffeine: your own pattern is more useful than a universal rule.',
  'Create a quiet wind-down routine for the last part of the evening. Dim bright screens, finish demanding tasks, and choose something calmer such as reading, stretching, or listening to music. The routine does not need to be elaborate. Repeating the same few cues can help your body recognize that sleep is approaching.',
  'Keep the bedroom comfortably cool, dark, and quiet, and make the bed a place associated with rest. If you remain awake for a long time, step away for a calm activity in low light, then return when you feel sleepy. Good sleep is built from patterns, not a single perfect night, so give each change enough time before deciding whether it works for you.',
] as const;

const text = DEMO_TRANSCRIPT_PARAGRAPHS.join('\n\n');

export const DEMO_TRANSCRIPT = {
  label: 'Synthetic demo',
  title: 'A short guide to better sleep',
  paragraphs: DEMO_TRANSCRIPT_PARAGRAPHS,
  filename: 'textify-demo-transcript.txt',
  text,
  exportText: `${text}\n`,
} as const;

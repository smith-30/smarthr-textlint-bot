import { App, LogLevel, KnownBlock, Block, AwsLambdaReceiver } from '@slack/bolt'
import { TextFixEngine } from 'textlint'
import * as path from 'path'
// require('dotenv').config()

import formatResults from './utils/formatResults'

type Blocks = (KnownBlock | Block)[]

const secret: string = process.env.SLACK_SIGNING_SECRET as string

const awsLambdaReceiver = new AwsLambdaReceiver({
  signingSecret: secret,
})

// アプリの初期化
const app = new App({
  logLevel: LogLevel.DEBUG,
  token: process.env.SLACK_BOT_TOKEN,
  receiver: awsLambdaReceiver,
})

/* @ts-ignore */
module.exports.handler = async (event, context, callback) => {
  // console.log(event.body)
  // console.log(event.headers)
  // const obj = JSON.parse(event.body);
  // if (obj.challenge) {
  //     return {
  //       statusCode: 200,
  //       body: JSON.stringify({
  //         challenge: obj.challenge,
  //       }),
  //   }
  // }
  if (event.headers['X-Slack-Retry-Num']) {
    return { statusCode: 200, body: JSON.stringify({ message: 'No need to resend' }) }
  }
  const handler = await awsLambdaReceiver.start()
  return handler(event, context, callback)
}

// textlintの初期化
const engine = new TextFixEngine({
  configFile: path.join(__dirname, '../.textlintrc.json'),
})

// メンション（@textlint）をトリガーとしたイベント実行
/* @ts-ignore */
app.event('app_mention', async ({ event, context }) => {
  console.log("textLen: ", event.text.length)
  // api response の payload が 3000 文字までのため
  // The text for the block, in the form of a text object. Minimum length for the text in this field is 1 and maximum length is 3000 characters.
  // This field is not required if a valid array of fields objects is provided instead.
  if (6000 < event.text.length) {
    await app.client.chat.postMessage({
      token: context.botToken,
      channel: event.channel,
      thread_ts: event.ts,
      text: '',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '文章が長すぎるため分割して送ってください。。！',
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '※<https://github.com/techtouch-inc/techblog-textlint#setup|こちらのリポジトリ>をセットアップすれば一括置換が可能です。',
            },
          ],
        },
      ],
    })
    return
  }

  await app.client.chat.postMessage({
    token: context.botToken,
    channel: event.channel,
    thread_ts: event.ts,
    text: '',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '文章を受け付けました！5 - 10秒ほどで結果がでます！',
        },
      },
    ],
  })

  let blocks: Blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '文書チェックが完了しました:tada:',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*文書のチェック結果:*',
      },
    },
  ]

  try {
    const regex = /^<@(.+?)>/g // memo: 最初の@textlintを除外する正規表現 https://www-creators.com/tool/regex-checker?r=%5E%3C%40(.%2B%3F)%3E
    const replaceText = event.text.replace(regex, '')
    const fixResults = await engine.executeOnText(replaceText)

    if (replaceText.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: 'おや？テキストの指定が無いですね。' },
      })
    } else if (engine.isErrorResults(fixResults)) {
      blocks = [
        ...blocks,
        {
          type: 'section',
          text: { type: 'mrkdwn', text: formatResults(fixResults) },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*自動修正文書の提案:*',
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: fixResults[0].output,
          },
        },
      ]
    } else {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '入力された文書にエラーは見つかりませんでした:+1:' },
      })
    }

    const asyncInForLoop = async () => {
      for (let i = 0; i < blocks.length; i++) {
        try {
          // Call chat.postMessage with the built-in client
          await app.client.chat.postMessage({
            token: context.botToken,
            channel: event.channel,
            thread_ts: event.ts,
            text: '',
            blocks: [blocks[i]],
          })
        } catch (error) {
          console.log("err", error)
          await app.client.chat.postMessage({
            token: context.botToken,
            channel: event.channel,
            thread_ts: event.ts,
            text: '',
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: '文章が長すぎるかもしれません。。2000文字程度におさめて実行してください。。！',
                },
              },
              {
                type: 'context',
                elements: [
                  {
                    type: 'mrkdwn',
                    text: '※<https://github.com/techtouch-inc/techblog-textlint#setup|こちらのリポジトリ>をセットアップすれば一括置換が可能です。',
                  },
                ],
              },
            ],
          })
          throw error
        }
      }
    }

    await asyncInForLoop()
  } catch (error) {
    console.log(error)
    throw error
  }
})

//https://github.com/techtouch-inc/techblog-textlint#setup
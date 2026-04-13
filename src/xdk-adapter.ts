import { Client } from "@xdevplatform/xdk";
import { handleResponse, wrapXdkError } from "./response.js";

export interface XdkAdapterConfig {
  bearerToken: string;
}

const TWEET_FIELDS = [
  "created_at",
  "public_metrics",
  "author_id",
  "conversation_id",
  "in_reply_to_user_id",
  "referenced_tweets",
  "attachments",
  "entities",
  "lang",
  "note_tweet",
];
const TWEET_FIELDS_SEARCH = [
  "created_at",
  "public_metrics",
  "author_id",
  "conversation_id",
  "entities",
  "lang",
  "note_tweet",
];
const USER_FIELDS_FULL = [
  "created_at",
  "description",
  "public_metrics",
  "verified",
  "profile_image_url",
  "url",
  "location",
  "pinned_tweet_id",
];
const USER_FIELDS_BASIC = ["name", "username", "verified", "profile_image_url"];
const MEDIA_FIELDS = ["url", "preview_image_url", "type", "width", "height", "alt_text"];
const MEDIA_FIELDS_BASIC = ["url", "preview_image_url", "type"];

function asRawResponse<T>(p: Promise<T>): Promise<Response> {
  return p as unknown as Promise<Response>;
}

/**
 * XDK-backed client for the 5 Bearer-auth read tools in PR 1 scope.
 * (get_timeline is intentionally excluded — see DIVERGENCES.md #1.)
 *
 * Returns the same { result, rateLimit } envelope as XApiClient so
 * existing MCP tool handlers work with either client unchanged.
 *
 * XDK's `Client.request()` throws ApiError on non-2xx responses BEFORE
 * honoring `requestOptions.raw`, so every method wraps the call in a
 * try/catch that reshapes ApiError back into the legacy error format
 * via `wrapXdkError`. Success paths still get the raw Response so
 * `handleResponse` can extract rate-limit headers identically.
 */
export class XdkAdapter {
  private client: Client;

  constructor(config: XdkAdapterConfig) {
    this.client = new Client({ bearerToken: config.bearerToken });
  }

  async getTweet(tweetId: string) {
    try {
      const response = await asRawResponse(
        this.client.posts.getById(tweetId, {
          tweetFields: TWEET_FIELDS,
          expansions: ["author_id", "referenced_tweets.id", "attachments.media_keys"],
          userFields: USER_FIELDS_FULL,
          mediaFields: MEDIA_FIELDS,
          requestOptions: { raw: true },
        }),
      );
      return await handleResponse(response, "getTweet");
    } catch (err) {
      throw wrapXdkError(err, "getTweet");
    }
  }

  async searchTweets(query: string, maxResults = 10, nextToken?: string) {
    const options: Record<string, unknown> = {
      maxResults: Math.min(Math.max(maxResults, 10), 100),
      tweetFields: TWEET_FIELDS_SEARCH,
      expansions: ["author_id", "attachments.media_keys"],
      userFields: USER_FIELDS_BASIC,
      mediaFields: MEDIA_FIELDS_BASIC,
      requestOptions: { raw: true },
    };
    if (nextToken) options.nextToken = nextToken;
    try {
      const response = await asRawResponse(this.client.posts.searchRecent(query, options));
      return await handleResponse(response, "searchTweets");
    } catch (err) {
      throw wrapXdkError(err, "searchTweets");
    }
  }

  async getUser(params: { username?: string; userId?: string }) {
    const opts = {
      userFields: USER_FIELDS_FULL,
      requestOptions: { raw: true as const },
    };
    try {
      let response: Response;
      if (params.userId) {
        response = await asRawResponse(this.client.users.getById(params.userId, opts));
      } else if (params.username) {
        const clean = params.username.replace(/^@/, "");
        response = await asRawResponse(this.client.users.getByUsername(clean, opts));
      } else {
        throw new Error("getUser requires username or userId");
      }
      return await handleResponse(response, "getUser");
    } catch (err) {
      throw wrapXdkError(err, "getUser");
    }
  }

  async getFollowers(userId: string, maxResults = 100, nextToken?: string) {
    const options: Record<string, unknown> = {
      maxResults: Math.min(Math.max(maxResults, 1), 1000),
      userFields: USER_FIELDS_BASIC,
      requestOptions: { raw: true },
    };
    if (nextToken) options.paginationToken = nextToken;
    try {
      const response = await asRawResponse(this.client.users.getFollowers(userId, options));
      return await handleResponse(response, "getFollowers");
    } catch (err) {
      throw wrapXdkError(err, "getFollowers");
    }
  }

  async getFollowing(userId: string, maxResults = 100, nextToken?: string) {
    const options: Record<string, unknown> = {
      maxResults: Math.min(Math.max(maxResults, 1), 1000),
      userFields: USER_FIELDS_BASIC,
      requestOptions: { raw: true },
    };
    if (nextToken) options.paginationToken = nextToken;
    try {
      const response = await asRawResponse(this.client.users.getFollowing(userId, options));
      return await handleResponse(response, "getFollowing");
    } catch (err) {
      throw wrapXdkError(err, "getFollowing");
    }
  }
}

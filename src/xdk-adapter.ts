import { Client } from "@xdevplatform/xdk";
import { handleResponse } from "./response.js";

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
  "name",
  "username",
  "verified",
  "profile_image_url",
  "public_metrics",
];
const USER_FIELDS_BASIC = ["name", "username", "verified", "profile_image_url"];
const MEDIA_FIELDS = ["url", "preview_image_url", "type", "width", "height", "alt_text"];
const MEDIA_FIELDS_BASIC = ["url", "preview_image_url", "type"];

/**
 * XDK-backed client covering the 6 Bearer-auth read tools (PR 1 scope).
 * Returns the same { result, rateLimit } envelope as XApiClient so
 * existing MCP tool handlers work with either client unchanged.
 *
 * Uses the XDK's `requestOptions: { raw: true }` overload to surface the
 * raw fetch Response so our shared `handleResponse` can extract rate-limit
 * headers and shape errors identically to the legacy path.
 */
export class XdkAdapter {
  private client: Client;

  constructor(config: XdkAdapterConfig) {
    this.client = new Client({ bearerToken: config.bearerToken });
  }

  async getTweet(tweetId: string) {
    const response = (await this.client.posts.getById(tweetId, {
      tweetFields: TWEET_FIELDS,
      expansions: ["author_id", "referenced_tweets.id", "attachments.media_keys"],
      userFields: USER_FIELDS_FULL,
      mediaFields: MEDIA_FIELDS,
      requestOptions: { raw: true },
    })) as unknown as Response;
    return handleResponse(response, "getTweet");
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
    const response = (await this.client.posts.searchRecent(query, options)) as unknown as Response;
    return handleResponse(response, "searchTweets");
  }

  async getUser(params: { username?: string; userId?: string }) {
    const opts = {
      userFields: USER_FIELDS_FULL,
      requestOptions: { raw: true as const },
    };
    let response: Response;
    if (params.userId) {
      response = (await this.client.users.getById(params.userId, opts)) as unknown as Response;
    } else if (params.username) {
      const clean = params.username.replace(/^@/, "");
      response = (await this.client.users.getByUsername(clean, opts)) as unknown as Response;
    } else {
      throw new Error("getUser requires username or userId");
    }
    return handleResponse(response, "getUser");
  }

  async getTimeline(userId: string, maxResults = 10, nextToken?: string) {
    const options: Record<string, unknown> = {
      maxResults: Math.min(Math.max(maxResults, 5), 100),
      tweetFields: TWEET_FIELDS_SEARCH,
      expansions: ["author_id", "attachments.media_keys"],
      userFields: USER_FIELDS_BASIC,
      mediaFields: MEDIA_FIELDS_BASIC,
      requestOptions: { raw: true },
    };
    if (nextToken) options.paginationToken = nextToken;
    const response = (await this.client.users.getTimeline(userId, options)) as unknown as Response;
    return handleResponse(response, "getTimeline");
  }

  async getFollowers(userId: string, maxResults = 100, nextToken?: string) {
    const options: Record<string, unknown> = {
      maxResults: Math.min(Math.max(maxResults, 1), 1000),
      userFields: USER_FIELDS_BASIC,
      requestOptions: { raw: true },
    };
    if (nextToken) options.paginationToken = nextToken;
    const response = (await this.client.users.getFollowers(userId, options)) as unknown as Response;
    return handleResponse(response, "getFollowers");
  }

  async getFollowing(userId: string, maxResults = 100, nextToken?: string) {
    const options: Record<string, unknown> = {
      maxResults: Math.min(Math.max(maxResults, 1), 1000),
      userFields: USER_FIELDS_BASIC,
      requestOptions: { raw: true },
    };
    if (nextToken) options.paginationToken = nextToken;
    const response = (await this.client.users.getFollowing(userId, options)) as unknown as Response;
    return handleResponse(response, "getFollowing");
  }
}

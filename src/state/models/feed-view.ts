import {makeAutoObservable, runInAction} from 'mobx'
import {bsky} from '@adxp/mock-api'
import {RootStoreModel} from './root-store'
import * as apilib from '../lib/api'

export class FeedViewItemMyStateModel {
  hasLiked: boolean = false
  hasReposted: boolean = false

  constructor() {
    makeAutoObservable(this)
  }
}

export class FeedViewItemModel implements bsky.FeedView.FeedItem {
  // ui state
  _reactKey: string = ''

  // data
  uri: string = ''
  author: bsky.FeedView.User = {did: '', name: '', displayName: ''}
  repostedBy?: bsky.FeedView.User
  record: Record<string, unknown> = {}
  embed?:
    | bsky.FeedView.RecordEmbed
    | bsky.FeedView.ExternalEmbed
    | bsky.FeedView.UnknownEmbed
  replyCount: number = 0
  repostCount: number = 0
  likeCount: number = 0
  indexedAt: string = ''
  myState = new FeedViewItemMyStateModel()

  constructor(
    public rootStore: RootStoreModel,
    reactKey: string,
    v: bsky.FeedView.FeedItem,
  ) {
    makeAutoObservable(this, {rootStore: false})
    this._reactKey = reactKey
    this.copy(v)
  }

  copy(v: bsky.FeedView.FeedItem) {
    this.uri = v.uri
    this.author = v.author
    this.repostedBy = v.repostedBy
    this.record = v.record
    this.embed = v.embed
    this.replyCount = v.replyCount
    this.repostCount = v.repostCount
    this.likeCount = v.likeCount
    this.indexedAt = v.indexedAt
    if (v.myState) {
      this.myState.hasLiked = v.myState.hasLiked
      this.myState.hasReposted = v.myState.hasReposted
    }
  }

  async toggleLike() {
    if (this.myState.hasLiked) {
      await apilib.unlike(this.rootStore.api, 'alice.com', this.uri)
      runInAction(() => {
        this.likeCount--
        this.myState.hasLiked = false
      })
    } else {
      await apilib.like(this.rootStore.api, 'alice.com', this.uri)
      runInAction(() => {
        this.likeCount++
        this.myState.hasLiked = true
      })
    }
  }

  async toggleRepost() {
    if (this.myState.hasReposted) {
      await apilib.unrepost(this.rootStore.api, 'alice.com', this.uri)
      runInAction(() => {
        this.repostCount--
        this.myState.hasReposted = false
      })
    } else {
      await apilib.repost(this.rootStore.api, 'alice.com', this.uri)
      runInAction(() => {
        this.repostCount++
        this.myState.hasReposted = true
      })
    }
  }
}

export class FeedViewModel implements bsky.FeedView.Response {
  // state
  isLoading = false
  isRefreshing = false
  hasLoaded = false
  error = ''
  params: bsky.FeedView.Params
  _loadPromise: Promise<void> | undefined
  _loadMorePromise: Promise<void> | undefined
  _updatePromise: Promise<void> | undefined

  // data
  feed: FeedViewItemModel[] = []

  constructor(public rootStore: RootStoreModel, params: bsky.FeedView.Params) {
    makeAutoObservable(
      this,
      {
        rootStore: false,
        params: false,
        _loadPromise: false,
        _loadMorePromise: false,
        _updatePromise: false,
      },
      {autoBind: true},
    )
    this.params = params
  }

  get hasContent() {
    return this.feed.length !== 0
  }

  get hasError() {
    return this.error !== ''
  }

  get isEmpty() {
    return this.hasLoaded && !this.hasContent
  }

  get loadMoreCursor() {
    if (this.hasContent) {
      return this.feed[this.feed.length - 1].indexedAt
    }
    return undefined
  }

  // public api
  // =

  /**
   * Load for first render
   */
  async setup(isRefreshing = false) {
    if (this._loadPromise) {
      return this._loadPromise
    }
    await this._pendingWork()
    this._loadPromise = this._initialLoad(isRefreshing)
    await this._loadPromise
    this._loadPromise = undefined
  }

  /**
   * Reset and load
   */
  async refresh() {
    return this.setup(true)
  }

  /**
   * Load more posts to the end of the feed
   */
  async loadMore() {
    if (this._loadMorePromise) {
      return this._loadMorePromise
    }
    await this._pendingWork()
    this._loadMorePromise = this._loadMore()
    await this._loadMorePromise
    this._loadMorePromise = undefined
  }

  /**
   * Update content in-place
   */
  async update() {
    if (this._updatePromise) {
      return this._updatePromise
    }
    await this._pendingWork()
    this._updatePromise = this._update()
    await this._updatePromise
    this._updatePromise = undefined
  }

  // state transitions
  // =

  private _xLoading(isRefreshing = false) {
    this.isLoading = true
    this.isRefreshing = isRefreshing
    this.error = ''
  }

  private _xIdle(err: string = '') {
    this.isLoading = false
    this.isRefreshing = false
    this.hasLoaded = true
    this.error = err
  }

  // loader functions
  // =

  private async _pendingWork() {
    if (this._loadPromise) {
      await this._loadPromise
    }
    if (this._loadMorePromise) {
      await this._loadMorePromise
    }
    if (this._updatePromise) {
      await this._updatePromise
    }
  }

  private async _initialLoad(isRefreshing = false) {
    this._xLoading(isRefreshing)
    await new Promise(r => setTimeout(r, 250)) // DEBUG
    try {
      const res = (await this.rootStore.api.mainPds.view(
        'blueskyweb.xyz:FeedView',
        this.params,
      )) as bsky.FeedView.Response
      this._replaceAll(res)
      this._xIdle()
    } catch (e: any) {
      this._xIdle(`Failed to load feed: ${e.toString()}`)
    }
  }

  private async _loadMore() {
    this._xLoading()
    await new Promise(r => setTimeout(r, 250)) // DEBUG
    try {
      const params = Object.assign({}, this.params, {
        before: this.loadMoreCursor,
      })
      const res = (await this.rootStore.api.mainPds.view(
        'blueskyweb.xyz:FeedView',
        params,
      )) as bsky.FeedView.Response
      this._appendAll(res)
      this._xIdle()
    } catch (e: any) {
      this._xIdle(`Failed to load feed: ${e.toString()}`)
    }
  }

  private async _update() {
    this._xLoading()
    await new Promise(r => setTimeout(r, 250)) // DEBUG
    let numToFetch = this.feed.length
    let cursor = undefined
    try {
      do {
        const res = (await this.rootStore.api.mainPds.view(
          'blueskyweb.xyz:FeedView',
          {
            before: cursor,
            limit: Math.min(numToFetch, 100),
          },
        )) as bsky.FeedView.Response
        if (res.feed.length === 0) {
          break // sanity check
        }
        this._updateAll(res)
        numToFetch -= res.feed.length
        cursor = this.feed[res.feed.length - 1].indexedAt
        console.log(numToFetch, cursor, res.feed.length)
      } while (numToFetch > 0)
      this._xIdle()
    } catch (e: any) {
      this._xIdle(`Failed to update feed: ${e.toString()}`)
    }
  }

  private _replaceAll(res: bsky.FeedView.Response) {
    this.feed.length = 0
    this._appendAll(res)
  }

  private _appendAll(res: bsky.FeedView.Response) {
    let counter = this.feed.length
    for (const item of res.feed) {
      this._append(counter++, item)
    }
  }

  private _append(keyId: number, item: bsky.FeedView.FeedItem) {
    // TODO: validate .record
    this.feed.push(new FeedViewItemModel(this.rootStore, `item-${keyId}`, item))
  }

  private _updateAll(res: bsky.FeedView.Response) {
    for (const item of res.feed) {
      const existingItem = this.feed.find(
        // this find function has a key subtley- the indexedAt comparison
        // the reason for this is reposts: they set the URI of the original post, not of the repost record
        // the indexedAt time will be for the repost however, so we use that to help us
        item2 => item.uri === item2.uri && item.indexedAt === item2.indexedAt,
      )
      if (existingItem) {
        existingItem.copy(item)
      }
    }
  }
}
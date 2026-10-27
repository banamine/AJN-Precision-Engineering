import assert from 'node:assert/strict';
import { NEWS_TABS, tabFromLocation } from './src/components/NewsTabs';

const ids = NEWS_TABS.map((tab) => tab.id);
assert.deepEqual(ids, ['rumble', 'youtube', 'bannedvideo']);
assert.equal(tabFromLocation({ hash: '#bannedvideo', pathname: '/' }), 'bannedvideo');
assert.equal(tabFromLocation({ hash: '', pathname: '/bannedvideo' }), 'bannedvideo');
assert.equal(tabFromLocation({ hash: '#BANNEDVIDEO', pathname: '/' }), 'bannedvideo');
assert.equal(tabFromLocation({ hash: '#news', pathname: '/' }), null);
assert.equal(tabFromLocation({ hash: '', pathname: '/news' }), null);
console.log('PASS BANNED VIDEO tab order, /bannedvideo deep link, and #bannedvideo hash');
